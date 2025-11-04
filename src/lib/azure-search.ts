import { AzureConfig, AzureSearchDocument, AzureSearchResult, Source } from '@/types'

export class AzureSearchService {
  private config: AzureConfig['search']

  constructor(config: AzureConfig['search']) {
    this.config = config
    // Normalize endpoint to avoid accidental double slashes in URLs
    this.config.endpoint = this.config.endpoint.replace(/\/+$/, '')
  }

  private shouldProxy(): boolean {
    return typeof window !== 'undefined'
  }

  private getBearerToken(): string | undefined {
    try {
      if (typeof window !== 'undefined') {
        const token = window.localStorage?.getItem('KV_API_KEY')
        if (token) {
          return token
        }
      }
    } catch {
      // ignore storage access errors (Safari ITP, disabled storage, etc.)
    }
    // Fallback for build-time key (e.g., for demos, CI)
    if (import.meta.env.VITE_KV_API_KEY) {
      return import.meta.env.VITE_KV_API_KEY
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
        return { success: false, error: `HTTP 400: ${errorText}` }
      }

      if (searchPing.status === 401 || searchPing.status === 403) {
        const errorText = await searchPing.text()
        return {
          success: false,
          error:
            'Authentication failed for Azure AI Search. Ensure you are using an admin key for index management or switch to an existing index that is accessible with the provided key. ' +
            `Details: HTTP ${searchPing.status} ${errorText}`
        }
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
        return { success: false, error: `HTTP ${metadataResponse.status}: ${metadataError}` }
      }

      return { success: true }
    } catch (error) {
      console.error('Azure Search testConnection error:', error)
      // Check if it's a CORS error
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return {
          success: false,
          error: 'CORS Error: Azure Search must be configured to allow requests from your origin. ' +
                 'In Azure Portal, go to your Search service → Settings → CORS, and add your origin ' +
                 '(e.g., http://localhost:5001 or your production URL). Note: Testing from localhost may ' +
                 'require enabling CORS for development. Alternatively, test the connection from a deployed environment.'
        }
      }
      return { success: false, error: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async createSearchIndex(): Promise<{ success: boolean; error?: string }> {
    try {
      const compressionEnabled = this.config.vectorCompression?.enabled ?? false
      const compressionMethod = this.config.vectorCompression?.method
      const compressionName = 'vector-compression'

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
            ...(compressionEnabled && { compression: compressionName })
          },
          {
            name: 'vector-profile-exhaustive',
            algorithm: 'exhaustive-algorithm'
          }
        ]
      }

      if (compressionEnabled && compressionMethod) {
        vectorSearchConfig.compressions = [
          {
            name: compressionName,
            kind: compressionMethod === 'scalar' ? 'scalarQuantization' : 'binaryQuantization',
            ...(compressionMethod === 'scalar' && { scalarQuantizationParameters: { quantizedDataType: 'int8' } })
          }
        ]
      }

      const indexSchema: unknown = {
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
            dimensions: 1536,
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
                contentFields: [
                  { name: 'content' }
                ],
                ...(this.config.semanticConfiguration.prioritizeTitle && {
                  titleField: { name: 'documentName' }
                }),
                ...(this.config.semanticConfiguration.prioritizeKeywords && {
                  keywordsFields: [
                    { name: 'metadata' }
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

      const response = await (this.shouldProxy()
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
          ))

      if (!response.ok) {
        const errorText = await response.text()
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
        const missingFieldMessageMatch = /The property '(\w+)' does not exist on type 'search\.documentFields'/i.exec(errorText)
        if (missingFieldMessageMatch && allowSchemaRefresh) {
          const refreshResult = await this.createSearchIndex()
          if (!refreshResult.success) {
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
      const failedDocs = result.value?.filter((item: unknown) => !item.status || item.status >= 400)

      if (failedDocs && failedDocs.length > 0) {
        return { success: false, error: `Some documents failed to index: ${JSON.stringify(failedDocs)}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: `Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async vectorSearch(queryVector: number[], top: number = 5): Promise<Source[]> {
    try {
      const searchRequest = {
        count: true,
        select: 'id,content,documentId,documentName,chunkIndex',
        vectors: [
          {
            value: queryVector,
            fields: 'contentVector',
            k: top
          }
        ]
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
      throw error
    }
  }

  async keywordSearch(query: string, top: number = 5, namespace?: string): Promise<Source[]> {
    try {
      const searchRequest: unknown = {
        search: query,
        searchMode: 'all',
        queryType: 'simple',
        select: 'id,content,documentId,documentName,chunkIndex,metadata',
        top
      }

      const effectiveNamespace = namespace || this.config.namespace
      if (effectiveNamespace) {
        searchRequest.filter = `metadata/any(m: contains(m, 'namespace_id":"${effectiveNamespace}"'))`
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

      const result: unknown = await response.json()

      return result.value.map((doc: unknown) => ({
        documentId: doc.documentId,
        documentName: doc.documentName,
        chunkId: doc.id,
        content: doc.content,
        relevanceScore: doc['@search.score'] ? doc['@search.score'] / 100 : 0.6,
        azureScore: doc['@search.score'] || 60
      }))
    } catch (error) {
      console.error('Error performing keyword search:', error)
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

      const searchRequest: unknown = {
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
        searchRequest.vectors = [
          {
            value: queryVector,
            fields: 'contentVector',
            k: top
          }
        ]
      }

      if (effectiveNamespace) {
        searchRequest.filter = `metadata/any(m: contains(m, 'namespace_id":"${effectiveNamespace}"'))`
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

      const result: unknown = await response.json()

      let sources = result.value.map((doc: unknown) => ({
        documentId: doc.documentId,
        documentName: doc.documentName,
        chunkId: doc.id,
        content: doc.content,
        relevanceScore: doc['@search.score'] ? doc['@search.score'] / 100 : 0.85,
        azureScore: doc['@search.score'] || 85,
        semanticCaption: doc['@search.captions']?.[0]?.text,
        semanticRerankerScore: doc['@search.rerankerScore']
      }))

      if (this.config.contextCompression?.enabled && this.config.contextCompression.method !== 'none') {
        sources = await this.applyContextualCompression(sources, query)
      }

      return sources
    } catch (error) {
      console.error('Error performing semantic hybrid search:', error)
      throw error
    }
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
        value: searchResult.value.map((doc: unknown) => ({
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
}
