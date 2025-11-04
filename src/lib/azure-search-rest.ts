
/* Azure AI Search REST client for 2025-08-01-preview */

export type BearerProvider = () => Promise<string>

export interface SearchRestClientOptions {
  endpoint: string            // e.g., https://{service}.search.windows.net
  apiVersion?: string         // default 2025-08-01-preview
  apiKey?: string             // admin or query key
  useRBAC?: boolean           // when true, use bearerProvider()
  bearerProvider?: BearerProvider // provides 'Bearer <token>'
  defaultIndex?: string       // optional default index
}

export class SearchRestClient {
  private endpoint: string
  private apiVersion: string
  private apiKey?: string
  private useRBAC: boolean
  private bearerProvider?: BearerProvider
  private defaultIndex?: string

  constructor(options: SearchRestClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '')
    this.apiVersion = options.apiVersion ?? '2025-08-01-preview'
    this.apiKey = options.apiKey
    this.useRBAC = options.useRBAC ?? false
    this.bearerProvider = options.bearerProvider
    this.defaultIndex = options.defaultIndex
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (this.useRBAC) {
      if (!this.bearerProvider) {
        throw new Error('RBAC selected but no bearerProvider supplied')
      }
      headers['Authorization'] = await this.bearerProvider()
    } else {
      if (!this.apiKey) throw new Error('apiKey required when RBAC is disabled')
      headers['api-key'] = this.apiKey
    }
    return headers
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.endpoint}${path}${path.includes('?') ? '&' : '?'}api-version=${this.apiVersion}`
    const headers = await this.authHeaders()
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as HeadersInit) } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status} ${res.statusText}: ${text}`)
    }
    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  }

  // Index management
  async createVectorIndex(params: {
    indexName: string
    dims: number
    vectorFieldName?: string
    textFieldName?: string
    metric?: 'cosine' | 'euclidean' | 'dotProduct'
    analyzer?: string
    compress?: 'scalar' | 'binary'
    includeSemanticConfig?: boolean
    extraFields?: Record<string, unknown>[]
  }): Promise<unknown> {
    const {
      indexName,
      dims,
      vectorFieldName = 'contentVector',
      textFieldName = 'content',
      metric = 'cosine',
      analyzer = 'en.microsoft',
      compress,
      includeSemanticConfig = false,
      extraFields = []
    } = params

    const compressionName = 'vector-compression'
    const compressionEnabled = !!compress

    const vectorSearchConfig: Record<string, unknown> = {
      algorithms: [
        {
          name: 'hnsw-default',
          kind: 'hnsw',
          hnswParameters: {
            metric,
            m: 8,
            efConstruction: 400
          }
        },
        {
          name: 'exhaustive-default',
          kind: 'exhaustiveKnn',
          exhaustiveKnnParameters: { metric }
        }
      ],
      profiles: [
        {
          name: 'vprofile',
          algorithm: 'hnsw-default',
          ...(compressionEnabled && { compression: compressionName })
        },
        { name: 'vprofile-exhaustive', algorithm: 'exhaustive-default' }
      ]
    }

    if (compressionEnabled) {
      vectorSearchConfig.compressions = [
        {
          name: compressionName,
          kind: compress === 'scalar' ? 'scalarQuantization' : 'binaryQuantization',
          ...(compress === 'scalar' && { scalarQuantizationParameters: { quantizedDataType: 'int8' } })
        }
      ]
    }

    const schema: Record<string, unknown> = {
      name: indexName,
      fields: [
        { name: 'id', type: 'Edm.String', key: true, searchable: false, filterable: true, retrievable: true },
        { name: textFieldName, type: 'Edm.String', searchable: true, retrievable: true, analyzer },
        {
          name: vectorFieldName,
          type: 'Collection(Edm.Single)',
          searchable: true,
          retrievable: false,
          dimensions: dims,
          vectorSearchProfile: 'vprofile'
        },
        { name: 'documentId', type: 'Edm.String', searchable: false, filterable: true, retrievable: true },
        { name: 'documentName', type: 'Edm.String', searchable: true, filterable: true, retrievable: true },
        { name: 'chunkIndex', type: 'Edm.Int32', searchable: false, filterable: true, sortable: true, retrievable: true },
        { name: 'metadata', type: 'Edm.String', searchable: true, retrievable: true, analyzer: 'keyword' },
        { name: 'createdAt', type: 'Edm.DateTimeOffset', searchable: false, filterable: true, sortable: true, retrievable: true },
        { name: 'contentLength', type: 'Edm.Int32', searchable: false, filterable: true, sortable: true, retrievable: true },
        ...extraFields
      ],
      vectorSearch: vectorSearchConfig
    }

    if (includeSemanticConfig) {
      schema.semantic = {
        configurations: [
          {
            name: 'semantic-config',
            prioritizedFields: {
              contentFields: [{ name: textFieldName }],
              titleField: { name: 'documentName' },
              keywordsFields: [{ name: 'metadata' }]
            }
          }
        ]
      }
    }

    return this.request('/indexes', {
      method: 'POST',
      body: JSON.stringify(schema)
    })
  }

  async deleteIndex(indexName: string): Promise<void> {
    await this.request(`/indexes('${encodeURIComponent(indexName)}')`, { method: 'DELETE' })
  }

  // Documents
  async indexDocuments(indexName: string, actions: Array<Record<string, unknown>>): Promise<unknown> {
    const payload = { value: actions }
    return this.request(`/indexes/${encodeURIComponent(indexName)}/docs/index`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  // Search: vector-only
  async searchVector(
    indexName: string,
    vector: number[],
    opts?: {
      fields?: string
      k?: number
      select?: string
      filter?: string
      vectorFilterMode?: 'preFilter' | 'postFilter' | 'strictPostFilter'
      threshold?: number | { kind: 'vectorSimilarity'; value: number }
    }
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      count: true,
      ...(opts?.select && { select: opts.select }),
      ...(opts?.filter && { filter: opts.filter }),
      ...(opts?.vectorFilterMode && { vectorFilterMode: opts.vectorFilterMode }),
      vectorQueries: [
        {
          kind: 'vector',
          vector,
          fields: opts?.fields ?? 'contentVector',
          k: opts?.k ?? 5,
          ...(opts?.threshold !== undefined && {
            threshold: typeof opts.threshold === 'number' ? { kind: 'vectorSimilarity', value: opts.threshold } : opts.threshold
          })
        }
      ]
    }
    return this.request(`/indexes/${encodeURIComponent(indexName)}/docs/search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
  }

  // Search: hybrid (BM25 + vector), with preview knobs
  async searchHybrid(
    indexName: string,
    query: string,
    vector: number[],
    opts?: {
      top?: number
      k?: number
      select?: string
      filter?: string
      weight?: number
      maxTextRecallSize?: number
      enableRRF?: boolean
      semantic?: { enabled: boolean; configName?: string; captions?: 'extractive' | 'none'; answers?: string }
      threshold?: number | { kind: 'vectorSimilarity'; value: number }
    }
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      search: query,
      top: opts?.top ?? 10,
      ...(opts?.select && { select: opts.select }),
      ...(opts?.filter && { filter: opts.filter }),
      vectorQueries: [
        {
          kind: 'vector',
          vector,
          fields: 'contentVector',
          k: opts?.k ?? Math.max(opts?.top ?? 10, 50),
          ...(opts?.threshold !== undefined && {
            threshold: typeof opts.threshold === 'number' ? { kind: 'vectorSimilarity', value: opts.threshold } : opts.threshold
          }),
          ...(opts?.weight && { weight: opts.weight })
        }
      ]
    }
    if (opts?.enableRRF || opts?.maxTextRecallSize) {
      body.hybridSearch = {
        ...(opts?.maxTextRecallSize && { maxTextRecallSize: opts.maxTextRecallSize }),
        countAndFacetMode: 'relaxed'
      }
    }
    if (opts?.semantic?.enabled) {
      body.queryType = 'semantic'
      body.semanticConfiguration = opts.semantic.configName ?? 'semantic-config'
      if (opts.semantic.captions) body.captions = opts.semantic.captions
      if (opts.semantic.answers) body.answers = opts.semantic.answers
    }
    return this.request(`/indexes/${encodeURIComponent(indexName)}/docs/search`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
  }

  // Knowledge agents (2025-08-01-preview)
  async createKnowledgeSource(name: string, indexes: Array<{ name: string }>): Promise<unknown> {
    return this.request('/knowledgesources', {
      method: 'POST',
      body: JSON.stringify({
        name,
        kind: 'searchIndex',
        parameters: { knowledgeSourceName: name, indexes }
      })
    })
  }

  async upsertAgent(agent: {
    name: string
    knowledgeSources: Array<{ name: string }>
    model: { kind: 'azureOpenAI'; deployment: string } | Record<string, unknown>
    reranker?: { kind: 'semantic' | 'none' } | null
    description?: string
  }): Promise<unknown> {
    const { name, ...rest } = agent
    return this.request(`/agents('${encodeURIComponent(name)}')`, {
      method: 'PUT',
      body: JSON.stringify({ name, ...rest })
    })
  }

  async retrieve(
    agentName: string,
    query: string,
    options?: {
      top?: number
      user?: { id?: string }
      context?: Record<string, unknown>
    }
  ): Promise<unknown> {
    const body: Record<string, unknown> = { agentName, query }
    if (options?.top !== undefined) body.top = options.top
    if (options?.user) body.user = options.user
    if (options?.context) body.context = options.context
    return this.request('/retrieve', {
      method: 'POST',
      body: JSON.stringify(body)
    })
  }
}
