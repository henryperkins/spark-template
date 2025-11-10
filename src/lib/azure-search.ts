import { AzureConfig, AzureSearchDocument, AzureSearchResult, Source } from '@/types'
import { errorTracking } from '@/lib/services/error-tracker'

export class AzureSearchService {
  private config: AzureConfig['search']

  constructor(config: AzureConfig['search']) {
    this.config = config
    // Normalize endpoint to avoid accidental double slashes in URLs
    this.config.endpoint = this.config.endpoint.replace(/\/+$/, '')
  }

  private shouldProxy(): boolean {
    // Only use proxy if explicitly enabled via environment variable
    // For Option A (direct Azure calls), we want to call Azure directly from the browser
    return typeof window !== 'undefined' && import.meta.env.VITE_AZURE_SEARCH_PROXY === 'true'
  }

  private getBearerToken(): string | undefined {
    try {
      if (typeof window !== 'undefined') {
        const token = window.localStorage?.getItem('AZURE_API_KEY')
        if (token) {
          return token
        }
      }
    } catch {
      // ignore storage access errors (Safari ITP, disabled storage, etc.)
    }
    // Fallback for build-time key (e.g., for demos, CI)
    if (import.meta.env.VITE_AZURE_SEARCH_KEY) {
      return import.meta.env.VITE_AZURE_SEARCH_KEY as string
    }
    return undefined
  }

  private proxyHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const token = this.getBearerToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const pingBody = JSON.stringify({
        search: '*',
        queryType: 'simple',
        top: 0,
        count: false
      })

      const searchPing = await (this.shouldProxy()
        ? fetch('/api/azure-search/search', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: JSON.parse(pingBody)
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/search?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json'
              },
              body: pingBody
            }
          ))

      if (searchPing.ok) {
        return { success: true }
      }

      if (searchPing.status === 404) {
        // Index doesn't exist, try to create it (requires admin key).
        const creationResult = await this.createSearchIndex()
        return creationResult
      }

      if (searchPing.status === 400) {
        const errorText = await searchPing.text()
        if (errorText.includes('Index') && errorText.includes('does not exist')) {
          return this.createSearchIndex()
        }
        const errMsg = `HTTP 400: ${errorText}`
        try { errorTracking.record(new Error(errMsg), { type: 'retrieval', agent: 'AzureSearch', status: 400, code: 'search_validation' }) } catch {
          // Ignore error tracking failures
        }
        return { success: false, error: errMsg }
      }

      if (searchPing.status === 401 || searchPing.status === 403) {
        const errorText = await searchPing.text()
        const err = {
          success: false,
          error:
            'Authentication failed for Azure AI Search. Ensure you are using an admin key for index management or switch to an existing index that is accessible with the provided key. ' +
            `Details: HTTP ${searchPing.status} ${errorText}`
        }
        try { errorTracking.record(new Error(err.error), { type: 'retrieval', agent: 'AzureSearch', status: searchPing.status, code: 'search_auth' }) } catch {
          // Ignore error tracking failures
        }
        return err
      }

      // Fall back to checking service metadata for other errors
      const metadataResponse = await (this.shouldProxy()
        ? fetch(`/api/azure-search/indexes/${encodeURIComponent(this.config.indexName)}?apiVersion=${encodeURIComponent(this.config.apiVersion)}`, {
            method: 'GET',
            headers: this.proxyHeaders()
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}?api-version=${this.config.apiVersion}`,
            {
              method: 'GET',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              }
            }
          ))

      if (!metadataResponse.ok) {
        const metadataError = await metadataResponse.text()
        const errMsg = `HTTP ${metadataResponse.status}: ${metadataError}`
        try { errorTracking.record(new Error(errMsg), { type: 'retrieval', agent: 'AzureSearch', status: metadataResponse.status, code: 'search_metadata' }) } catch {
          // Ignore error tracking failures
        }
        return { success: false, error: errMsg }
      }

      return { success: true }
    } catch (error) {
      console.error('Azure Search testConnection error:', error)
      // Check if it's a CORS error
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'your domain'
        const portalUrl = 'https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.Search%2FsearchServices'
        const serviceName = this.config.endpoint.replace('https://', '').replace('.search.windows.net', '')
        
        const err = {
          success: false,
          error: `CORS Error: Azure Search blocks requests from ${origin}

Quick Fix (2 minutes):
1. Open Azure Portal: ${portalUrl}
2. Select your Search service: "${serviceName}"
3. Go to Settings → CORS
4. Add origin: ${origin}
5. Click Save and wait 2-3 minutes

Alternative Solutions:
• Enable proxy mode: Set VITE_AZURE_SEARCH_PROXY=true in your environment
• See full guide: https://github.com/your-repo/docs/CORS-RESOLUTION.md`
        }
        try { errorTracking.record(new Error(err.error), { type: 'retrieval', agent: 'AzureSearch', code: 'search_cors' }) } catch {
          // Ignore error tracking failures
        }
        return err
      }
      const errMsg = `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      try { errorTracking.record(new Error(errMsg), { type: 'retrieval', agent: 'AzureSearch', code: 'search_connection' }) } catch {
        // Ignore error tracking failures
      }
      return { success: false, error: errMsg }
    }
  }

  async createSearchIndex(
    vectorDimensions?: number,
    options?: { allowRebuildOnImmutableFieldError?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const dimensions = vectorDimensions ?? this.getDefaultVectorDimensions()
      const allowRebuildOnImmutableFieldError = options?.allowRebuildOnImmutableFieldError ?? true

      // Fetch existing index metadata so we can preserve settings Azure won't let us remove (e.g., compression)
      let existingIndex: Record<string, unknown> | null = null
      try {
        const existingIndexResponse = await (this.shouldProxy()
          ? fetch(
              `/api/azure-search/indexes/${encodeURIComponent(this.config.indexName)}?apiVersion=${encodeURIComponent(this.config.apiVersion)}`,
              {
                method: 'GET',
                headers: this.proxyHeaders()
              }
            )
          : fetch(
              `${this.config.endpoint}/indexes/${this.config.indexName}?api-version=${this.config.apiVersion}`,
              {
                method: 'GET',
                headers: {
                  'api-key': this.config.apiKey,
                  'Content-Type': 'application/json'
                }
              }
            ))

        if (existingIndexResponse.ok) {
          existingIndex = (await existingIndexResponse.json()) as Record<string, unknown>
        }
      } catch {
        // Ignore fetch errors when probing for existing index metadata
      }

      type VectorProfile = Record<string, unknown>
      type VectorCompression = Record<string, unknown>

      const existingProfiles: VectorProfile[] = Array.isArray(
        (existingIndex as { vectorSearch?: { profiles?: VectorProfile[] } } | null)?.vectorSearch?.profiles
      )
        ? ((existingIndex as { vectorSearch?: { profiles?: VectorProfile[] } } | null)?.vectorSearch?.profiles as VectorProfile[])
        : []

      let existingCompressionName: string | undefined
      for (const profile of existingProfiles) {
        if (
          profile &&
          typeof profile === 'object' &&
          'compression' in profile &&
          typeof (profile as { compression?: unknown }).compression === 'string'
        ) {
          if ((profile as { name?: unknown }).name === 'vector-profile-hnsw') {
            existingCompressionName = (profile as { compression: string }).compression
            break
          }
          if (!existingCompressionName) {
            existingCompressionName = (profile as { compression: string }).compression
          }
        }
      }

      const existingCompressions: VectorCompression[] = Array.isArray(
        (existingIndex as { vectorSearch?: { compressions?: VectorCompression[] } } | null)?.vectorSearch?.compressions
      )
        ? ((existingIndex as { vectorSearch?: { compressions?: VectorCompression[] } } | null)
            ?.vectorSearch?.compressions as VectorCompression[])
        : []

      const resolveCompressionMethod = (entry: VectorCompression | undefined): 'scalar' | 'binary' | undefined => {
        if (!entry || typeof entry !== 'object') return undefined
        const kind = (entry as { kind?: unknown }).kind
        if (kind === 'scalarQuantization') return 'scalar'
        if (kind === 'binaryQuantization') return 'binary'
        return undefined
      }

      const findCompressionEntry = (name: string | undefined): VectorCompression | undefined => {
        if (!name) return undefined
        return existingCompressions.find(
          compression =>
            compression &&
            typeof compression === 'object' &&
            (compression as { name?: unknown }).name === name
        )
      }

      const existingCompressionEntry = findCompressionEntry(existingCompressionName)
      let existingCompressionMethod = resolveCompressionMethod(existingCompressionEntry)

      if (!existingCompressionEntry && existingCompressions.length > 0) {
        const fallbackEntry = existingCompressions[0]
        if (!existingCompressionName && fallbackEntry && typeof fallbackEntry === 'object') {
          const fallbackName = (fallbackEntry as { name?: unknown }).name
          if (typeof fallbackName === 'string') {
            existingCompressionName = fallbackName
          }
        }
        existingCompressionMethod = resolveCompressionMethod(fallbackEntry)
      }

      const wantsCompression = this.config.vectorCompression?.enabled ?? false
      let compressionEnabled = wantsCompression
      let compressionMethod: 'scalar' | 'binary' | undefined = wantsCompression
        ? this.config.vectorCompression?.method
        : undefined
      let compressionName = existingCompressionName ?? 'vector-compression'

      if (existingCompressionMethod) {
        // Azure does not allow dropping compression once applied; preserve the existing setting.
        compressionEnabled = true
        if (!compressionMethod) {
          compressionMethod = existingCompressionMethod
        }
        if (existingCompressionName) {
          compressionName = existingCompressionName
        }
      } else if (wantsCompression) {
        compressionName = 'vector-compression'
      }

      if (compressionEnabled && !compressionMethod) {
        compressionMethod = 'scalar'
      }

      const vectorSearchConfig: Record<string, unknown> = {
        algorithms: [
          {
            name: 'hnsw-algorithm',
            kind: 'hnsw',
            hnswParameters: {
              metric: 'cosine',
              m: 8,
              efConstruction: 800,
              efSearch: 800
            }
          },
          {
            name: 'exhaustive-algorithm',
            kind: 'exhaustiveKnn',
            exhaustiveKnnParameters: {
              metric: 'cosine'
            }
          }
        ],
        profiles: [
          {
            name: 'vector-profile-hnsw',
            algorithm: 'hnsw-algorithm',
            ...(compressionEnabled && compressionName ? { compression: compressionName } : {})
          },
          {
            name: 'vector-profile-exhaustive',
            algorithm: 'exhaustive-algorithm'
          }
        ]
      }

      if (compressionEnabled && compressionMethod && compressionName) {
        const baseCompression =
          existingCompressionEntry && (existingCompressionEntry as { name?: unknown }).name === compressionName
            ? { ...existingCompressionEntry }
            : {
                name: compressionName
              }

        const compressionPayload: Record<string, unknown> = {
          ...baseCompression,
          kind: compressionMethod === 'scalar' ? 'scalarQuantization' : 'binaryQuantization'
        }

        if (compressionMethod === 'scalar') {
          compressionPayload.scalarQuantizationParameters = { quantizedDataType: 'int8' }
        } else {
          delete (compressionPayload as { scalarQuantizationParameters?: unknown }).scalarQuantizationParameters
        }

        vectorSearchConfig.compressions = [compressionPayload]
      }

      const indexSchema: Record<string, unknown> = {
        name: this.config.indexName,
        fields: [
          {
            name: 'id',
            type: 'Edm.String',
            key: true,
            searchable: false,
            filterable: true,
            retrievable: true
          },
          {
            name: 'content',
            type: 'Edm.String',
            searchable: true,
            filterable: false,
            retrievable: true,
            analyzer: 'en.microsoft'
          },
          {
            name: 'contentVector',
            type: 'Collection(Edm.Single)',
            searchable: true,
            filterable: false,
            retrievable: true,
            dimensions,
            vectorSearchProfile: 'vector-profile-hnsw'
          },
          {
            name: 'documentId',
            type: 'Edm.String',
            searchable: false,
            filterable: true,
            retrievable: true
          },
          {
            name: 'namespaceId',
            type: 'Edm.String',
            searchable: false,
            filterable: true,
            retrievable: true
          },
          {
            name: 'documentName',
            type: 'Edm.String',
            searchable: true,
            filterable: true,
            retrievable: true
          },
          {
            name: 'chunkIndex',
            type: 'Edm.Int32',
            searchable: false,
            filterable: true,
            sortable: true,
            retrievable: true
          },
          {
            name: 'metadata',
            type: 'Edm.String',
            searchable: true,
            filterable: false,
            retrievable: true,
            analyzer: 'keyword'
          },
          {
            name: 'createdAt',
            type: 'Edm.DateTimeOffset',
            searchable: false,
            filterable: true,
            sortable: true,
            retrievable: true
          },
          {
            name: 'contentLength',
            type: 'Edm.Int32',
            searchable: false,
            filterable: true,
            sortable: true,
            retrievable: true
          }
        ],
        vectorSearch: vectorSearchConfig
      }

      if (this.config.semanticConfiguration?.enabled) {
        indexSchema.semantic = {
          configurations: [
            {
              name: this.config.semanticConfiguration.configName || 'semantic-config',
              prioritizedFields: {
                prioritizedContentFields: [
                  { fieldName: 'content' }
                ],
                ...(this.config.semanticConfiguration.prioritizeTitle && {
                  titleField: { fieldName: 'documentName' }
                }),
                ...(this.config.semanticConfiguration.prioritizeKeywords && {
                  prioritizedKeywordsFields: [
                    { fieldName: 'metadata' }
                  ]
                })
              }
            }
          ]
        }
      }

      if (this.config.customScoring?.enabled) {
        indexSchema.scoringProfiles = [
          {
            name: 'quality-scoring',
            text: {
              weights: {
                content: 1.0,
                documentName: 0.5,
                metadata: this.config.customScoring.metadataWeight || 0.3
              }
            },
            functions: [
              {
                type: 'freshness',
                fieldName: 'createdAt',
                boost: this.config.customScoring.recencyWeight || 2.0,
                interpolation: 'linear',
                freshness: {
                  boostingDuration: 'P30D'
                }
              },
              {
                type: 'magnitude',
                fieldName: 'contentLength',
                boost: this.config.customScoring.lengthWeight || 1.5,
                interpolation: 'logarithmic',
                magnitude: {
                  boostingRangeStart: 100,
                  boostingRangeEnd: 2000,
                  constantBoostBeyondRange: false
                }
              }
            ],
            functionAggregation: 'sum'
          }
        ]
      }

      const doCreateRequest = () =>
        this.shouldProxy()
        ? fetch('/api/azure-search/create-index', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              schema: indexSchema,
              allowIndexDowntime: true
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}?api-version=${this.config.apiVersion}&allowIndexDowntime=true`,
            {
              method: 'PUT',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(indexSchema)
            }
          )

      let response = await doCreateRequest()

      if (!response.ok) {
        const errorText = await response.text()
        const cannotChangeField = /CannotChangeExistingField|Existing field 'contentVector' cannot be changed/i.test(errorText)
        const cannotChangeCompression = /CannotModifyVectorCompressionConfiguration|Cannot add compression to a field/i.test(errorText)

        if (cannotChangeField) {
          // 1) Wait in case prior deletion is still in progress, then retry once.
          const waited = await this.waitForIndexRemoval(60, 2000)
          if (waited) {
            response = await doCreateRequest()
            if (response.ok) return { success: true }
          }
        }

        if ((cannotChangeField || cannotChangeCompression) && allowRebuildOnImmutableFieldError) {
          // 2) If still failing and allowed, do a full rebuild (DELETE -> wait -> PUT)
          const rebuild = await this.rebuildIndex(dimensions)
          if (rebuild.success) {
            return { success: true }
          }
          const reason = cannotChangeCompression ? 'compression change rejected' : 'immutable field change'
          return {
            success: false,
            error: `Index creation failed after rebuild attempt (${reason}): ${rebuild.error ?? 'Unknown error'}`
          }
        }

        if (cannotChangeCompression) {
          return {
            success: false,
            error:
              `Index creation failed: ${response.status} ${errorText}. ` +
              'Azure AI Search does not allow toggling vector compression on an existing index. ' +
              'Delete the index (or allow this code path to rebuild automatically) before enabling compression.'
          }
        }

        return { success: false, error: `Index creation failed: ${response.status} ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      // Check if it's a CORS error
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return {
          success: false,
          error: 'CORS Error: Cannot create index. Please configure CORS in Azure Portal (Search service → Settings → CORS).'
        }
      }
      return { success: false, error: `Index creation failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async rebuildIndex(vectorDimensions?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const deleteResponse = await (this.shouldProxy()
        ? fetch(
            `/api/azure-search/indexes/${encodeURIComponent(this.config.indexName)}?apiVersion=${encodeURIComponent(this.config.apiVersion)}`,
            {
              method: 'DELETE',
              headers: this.proxyHeaders()
            }
          )
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}?api-version=${this.config.apiVersion}`,
            {
              method: 'DELETE',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              }
            }
          ))

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const errorText = await deleteResponse.text()
        return { success: false, error: `Index delete failed: ${deleteResponse.status} ${errorText}` }
      }

      if (deleteResponse.status !== 404) {
        const deletionConfirmed = await this.waitForIndexRemoval()
        if (!deletionConfirmed) {
          return {
            success: false,
            error:
              `Timed out waiting for index '${this.config.indexName}' to delete. Please wait 30–120 seconds and try again.`
          }
        }
      }

      return this.createSearchIndex(vectorDimensions, { allowRebuildOnImmutableFieldError: false })
    } catch (error) {
      return { success: false, error: `Index rebuild failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  private async waitForIndexRemoval(maxAttempts: number = 90, delayMs: number = 2000): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const checkResponse = await (this.shouldProxy()
        ? fetch(
            `/api/azure-search/indexes/${encodeURIComponent(this.config.indexName)}?apiVersion=${encodeURIComponent(this.config.apiVersion)}`,
            {
              method: 'GET',
              headers: this.proxyHeaders()
            }
          )
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}?api-version=${this.config.apiVersion}`,
            {
              method: 'GET',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              }
            }
          ))

      if (checkResponse.status === 404) {
        return true
      }

      // In-flight deletion returns 202/204, keep waiting
      if (checkResponse.status === 202 || checkResponse.status === 204) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }

      if (checkResponse.ok) {
        // Index still exists
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }

      // Unexpected error; break and propagate failure
      return false
    }
    return false
  }

  private getDefaultVectorDimensions(): number {
    const configuredDimension = (this.config as { vectorDimensions?: number }).vectorDimensions
    if (typeof configuredDimension === 'number' && configuredDimension > 0) {
      return configuredDimension
    }
    return 1536
  }

  async indexDocuments(
    documents: AzureSearchDocument[],
    namespace?: string,
    allowSchemaRefresh: boolean = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const effectiveNamespace = namespace || this.config.namespace || 'default'

      const batch = {
        value: documents.map(doc => ({
          '@search.action': 'mergeOrUpload',
          id: doc.id,
          content: doc.content,
          contentVector: doc.contentVector,
          documentId: doc.documentId,
          documentName: doc.documentName,
          chunkIndex: doc.chunkIndex,
          namespaceId: effectiveNamespace,
          metadata: doc.metadata ? JSON.stringify({
            ...doc.metadata,
            namespace_id: effectiveNamespace,
            tenant: doc.metadata.tenant || effectiveNamespace,
            timestamp: new Date().toISOString()
          }) : JSON.stringify({ namespace_id: effectiveNamespace, timestamp: new Date().toISOString() }),
          createdAt: new Date().toISOString(),
          contentLength: doc.content.length
        }))
      }

      const response = await (this.shouldProxy()
        ? fetch('/api/azure-search/index', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              batch
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/index?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(batch)
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        const dimensionMismatch = /mismatch in vector dimensions/i.test(errorText)
        const providedMatch = /provided vector has a length of '(\d+)'/i.exec(errorText)
        if (dimensionMismatch && allowSchemaRefresh) {
          const providedDimensions = providedMatch
            ? Number.parseInt(providedMatch[1], 10)
            : (documents[0]?.contentVector?.length ?? this.getDefaultVectorDimensions())
          // Perform a full rebuild to safely change vector dimensions.
          const rebuildResult = await this.rebuildIndex(providedDimensions)
          if (!rebuildResult.success) {
            return {
              success: false,
              error: `Indexing failed due to vector dimension mismatch and automatic index rebuild failed: ${rebuildResult.error || 'Unknown rebuild error'}. Original error: ${errorText}`
            }
          }
          return this.indexDocuments(documents, namespace, false)
        }
        const missingFieldMessageMatch = /The property '(\w+)' does not exist on type 'search\.documentFields'/i.exec(errorText)
        if (missingFieldMessageMatch && allowSchemaRefresh) {
          const refreshResult = await this.createSearchIndex()
          if (!refreshResult.success) {
            console.error('Schema refresh failed:', refreshResult.error)
            return {
              success: false,
              error: `Indexing failed after attempting to refresh index schema: ${refreshResult.error || 'Unknown schema refresh error'}. Original error: ${errorText}`
            }
          }
          // Retry once with schema refreshed
          return this.indexDocuments(documents, namespace, false)
        }
        const guidanceSuffix = missingFieldMessageMatch
          ? ` Hint: Ensure the Azure AI Search index '${this.config.indexName}' defines the '${missingFieldMessageMatch[1]}' field with the expected data type (for example, 'content' as Edm.String and 'contentVector' as Collection(Edm.Single)). You may need to recreate or update the index schema before indexing.`
          : ''
        return { success: false, error: `Indexing failed: ${response.status} ${errorText}${guidanceSuffix}` }
      }

      const result = await response.json()
      const failedDocs = result.value?.filter((item: { status?: number }) => !item.status || item.status >= 400)

      if (failedDocs && failedDocs.length > 0) {
        return { success: false, error: `Some documents failed to index: ${JSON.stringify(failedDocs)}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: `Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async vectorSearch(queryVector: number[], top: number = 5, namespace?: string): Promise<Source[]> {
    try {
      const effectiveNamespace = namespace || this.config.namespace

      const searchRequest: Record<string, unknown> = {
        count: true,
        select: 'id,content,documentId,documentName,chunkIndex',
        vectorQueries: [
          {
            kind: 'vector',
            vector: queryVector,
            fields: 'contentVector',
            k: top
          }
        ]
      }

      if (effectiveNamespace) {
        searchRequest.filter = this.buildNamespaceFilter(effectiveNamespace)
      }

      const response = await (this.shouldProxy()
        ? fetch('/api/azure-search/search', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: searchRequest
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/search?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(searchRequest)
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Vector search failed: ${response.status} ${errorText}`)
      }

      const result: AzureSearchResult = await response.json()

      return result.value.map(doc => ({
        documentId: doc.documentId,
        documentName: doc.documentName,
        chunkId: doc.id,
        content: doc.content,
        relevanceScore: 0.8, // Azure AI Search doesn't return scores in the same format
        azureScore: 0.8
      }))
    } catch (error) {
      console.error('Error performing vector search:', error)
      try { errorTracking.record(error as Error, { type: 'retrieval', agent: 'AzureSearch', code: 'vector_search' }) } catch {
        // Ignore error tracking failures
      }
      throw error
    }
  }

  async keywordSearch(query: string, top: number = 5, namespace?: string): Promise<Source[]> {
    try {
      const searchRequest: Record<string, unknown> = {
        search: query,
        searchMode: 'all',
        queryType: 'simple',
        select: 'id,content,documentId,documentName,chunkIndex,metadata',
        top
      }

      const effectiveNamespace = namespace || this.config.namespace
      if (effectiveNamespace) {
        searchRequest.filter = this.buildNamespaceFilter(effectiveNamespace)
      }

      const response = await (this.shouldProxy()
        ? fetch('/api/azure-search/search', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: searchRequest
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/search?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(searchRequest)
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Keyword search failed: ${response.status} ${errorText}`)
      }

      const result: { value: Array<Record<string, unknown>> } = await response.json()

      return result.value.map((doc: Record<string, unknown>) => ({
        documentId: doc.documentId as string,
        documentName: doc.documentName as string,
        chunkId: doc.id as string,
        content: doc.content as string,
        relevanceScore: doc['@search.score'] ? (doc['@search.score'] as number) / 100 : 0.6,
        azureScore: (doc['@search.score'] as number | undefined) || 60
      }))
    } catch (error) {
      console.error('Error performing keyword search:', error)
      try { errorTracking.record(error as Error, { type: 'retrieval', agent: 'AzureSearch', code: 'keyword_search' }) } catch {
        // Ignore error tracking failures
      }
      throw error
    }
  }

  async semanticHybridSearch(query: string, queryVector: number[], top: number = 5, namespace?: string): Promise<Source[]> {
    try {
      const useHybridSearch = this.config.hybridSearch?.enabled ?? true
      const useSemanticSearch = this.config.semanticConfiguration?.enabled
      const scoringProfile = this.config.customScoring?.enabled ? 'quality-scoring' : undefined
      const effectiveNamespace = namespace || this.config.namespace
      const maxTextRecallSize = this.config.hybridSearch?.maxTextRecallSize ?? 2000

      const searchRequest: Record<string, unknown> = {
        search: query,
        count: true,
        select: 'id,content,documentId,documentName,chunkIndex,createdAt,contentLength,metadata',
        top,
        ...(scoringProfile && { scoringProfile })
      }

      if (useHybridSearch) {
        searchRequest.vectorQueries = [
          {
            kind: 'vector',
            vector: queryVector,
            fields: 'contentVector',
            k: Math.max(top, 50)
          }
        ]

        if (this.config.hybridSearch?.enableRRF) {
          searchRequest.hybridSearch = {
            maxTextRecallSize,
            countAndFacetMode: 'relaxed'
          }
        }
      } else {
        // Use modern vectorQueries format even when hybrid search is disabled
        searchRequest.vectorQueries = [
          {
            kind: 'vector',
            vector: queryVector,
            fields: 'contentVector',
            k: top
          }
        ]
      }

      if (effectiveNamespace) {
        searchRequest.filter = this.buildNamespaceFilter(effectiveNamespace)
      }

      if (useSemanticSearch && this.config.hybridSearch?.enableSemanticReranker) {
        searchRequest.queryType = 'semantic'
        searchRequest.semanticConfiguration = this.config.semanticConfiguration?.configName || 'semantic-config'
        searchRequest.captions = 'extractive'
        searchRequest.answers = 'extractive|count-3'
      }

      const response = await (this.shouldProxy()
        ? fetch('/api/azure-search/search', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: searchRequest
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/search?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(searchRequest)
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Semantic hybrid search failed: ${response.status} ${errorText}`)
      }

      const result: { value: Array<Record<string, unknown>> } = await response.json()

      let sources: Source[] = result.value.map((doc: Record<string, unknown>) => ({
        documentId: doc.documentId as string,
        documentName: doc.documentName as string,
        chunkId: doc.id as string,
        content: doc.content as string,
        relevanceScore: doc['@search.score'] ? (doc['@search.score'] as number) / 100 : 0.85,
        azureScore: (doc['@search.score'] as number | undefined) ?? 85,
        semanticCaption: (doc['@search.captions'] as Array<{ text?: string }> | undefined)?.[0]?.text,
        semanticRerankerScore: doc['@search.rerankerScore'] as number | undefined
      }))

      if (this.config.contextCompression?.enabled && this.config.contextCompression.method !== 'none') {
        sources = await this.applyContextualCompression(sources, query)
      }

      return sources
    } catch (error) {
      console.error('Error performing semantic hybrid search:', error)
      try { errorTracking.record(error as Error, { type: 'retrieval', agent: 'AzureSearch', code: 'semantic_hybrid_search' }) } catch {
        // Ignore error tracking failures
      }
      throw error
    }
  }

  private buildNamespaceFilter(namespace: string): string {
    const safeNamespace = namespace.replace(/'/g, "''")
    return `namespaceId eq '${safeNamespace}'`
  }

  private async applyContextualCompression(sources: Source[], query: string): Promise<Source[]> {
    const compressionRatio = this.config.contextCompression?.compressionRatio ?? 0.5

    if (this.config.contextCompression?.method === 'extractive') {
      return sources.map(source => {
        const sentences = source.content.split(/[.!?]+/).filter(s => s.trim().length > 0)
        const targetSentences = Math.max(1, Math.floor(sentences.length * compressionRatio))

        const queryWords = new Set(query.toLowerCase().split(/\s+/))
        const scoredSentences = sentences.map(sentence => {
          const sentenceWords = sentence.toLowerCase().split(/\s+/)
          const relevance = sentenceWords.filter(w => queryWords.has(w)).length
          return { sentence, relevance }
        })

        const topSentences = scoredSentences
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, targetSentences)
          .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))

        return {
          ...source,
          content: topSentences.map(s => s.sentence).join('. ') + '.'
        }
      })
    }

    return sources
  }

  async deleteDocumentChunks(documentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const searchRequest = {
        search: '*',
        filter: `documentId eq '${documentId}'`,
        select: 'id'
      }

      const searchResponse = await (this.shouldProxy()
        ? fetch('/api/azure-search/search', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: searchRequest
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/search?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(searchRequest)
            }
          ))

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text()
        return { success: false, error: `Failed to find documents: ${searchResponse.status} ${errorText}` }
      }

      const searchResult = await searchResponse.json()

      if (!searchResult.value || searchResult.value.length === 0) {
        return { success: true } // No documents to delete
      }

      const deleteBatch = {
        value: searchResult.value.map((doc: { id: string }) => ({
          '@search.action': 'delete',
          id: doc.id
        }))
      }

      const deleteResponse = await (this.shouldProxy()
        ? fetch('/api/azure-search/index', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              batch: deleteBatch
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/docs/index?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(deleteBatch)
            }
          ))

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text()
        return { success: false, error: `Delete failed: ${deleteResponse.status} ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async testAnalyzer(text: string, analyzer: string = 'en.microsoft'): Promise<{ tokens: Array<{ token: string; startOffset: number; endOffset: number; position: number }>; error?: string }> {
    try {
      const analyzeRequest = {
        text,
        analyzer
      }

      const response = await (this.shouldProxy()
        ? fetch('/api/azure-search/analyze', {
            method: 'POST',
            headers: this.proxyHeaders(),
            body: JSON.stringify({
              indexName: this.config.indexName,
              apiVersion: this.config.apiVersion,
              request: analyzeRequest
            })
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/analyze?api-version=${this.config.apiVersion}`,
            {
              method: 'POST',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(analyzeRequest)
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        return { tokens: [], error: `Analyzer test failed: ${response.status} ${errorText}` }
      }

      const result = await response.json()
      return { tokens: result.tokens || [] }
    } catch (error) {
      return { tokens: [], error: `Analyzer test failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async getIndexStats(): Promise<{ documentCount: number; storageSize: number; error?: string }> {
    try {
      const response = await (this.shouldProxy()
        ? fetch(`/api/azure-search/indexes/${encodeURIComponent(this.config.indexName)}/stats?apiVersion=${encodeURIComponent(this.config.apiVersion)}`, {
            method: 'GET',
            headers: this.proxyHeaders()
          })
        : fetch(
            `${this.config.endpoint}/indexes/${this.config.indexName}/stats?api-version=${this.config.apiVersion}`,
            {
              method: 'GET',
              headers: {
                'api-key': this.config.apiKey,
                'Content-Type': 'application/json'
              }
            }
          ))

      if (!response.ok) {
        const errorText = await response.text()
        return { documentCount: 0, storageSize: 0, error: `Failed to get index stats: ${response.status} ${errorText}` }
      }

      const result = await response.json()
      return {
        documentCount: result.documentCount || 0,
        storageSize: result.storageSize || 0
      }
    } catch (error) {
      return { documentCount: 0, storageSize: 0, error: `Failed to get index stats: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }
}
