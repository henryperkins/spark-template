export interface Document {
  id: string
  name: string
  size: number
  uploadedAt: string
  type: string
  chunks: DocumentChunk[]
  processed: boolean
  azureIndexed?: boolean
  processingStatus?: 'pending' | 'processing' | 'completed' | 'error'
  errorMessage?: string
  source?: 'upload' | 'github' | 'website' | 'dropbox' | 'onedrive'
  sourceUrl?: string
  sourceMetadata?: Record<string, unknown>
  originalContent?: string
}

export interface DocumentIndex {
  id: string
  name: string
  size: number
  uploadedAt: string
  type: string
  source?: 'upload' | 'github' | 'website' | 'dropbox' | 'onedrive'
  sourceUrl?: string
  processingStatus: 'pending' | 'processing' | 'completed' | 'error'
  azureIndexed?: boolean
  errorMessage?: string
  chunkCount: number
  hasVectors?: boolean
}

export interface DocumentMeta extends Omit<DocumentIndex, 'chunkCount' | 'hasVectors'> {
  sourceMetadata?: Record<string, unknown>
  originalContent?: string
}

export interface DocumentChunk {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  embedding?: number[]
  azureEmbedding?: number[]
  vectorId?: string
  namespace?: string
  metadata?: ChunkMetadata
}

export interface ChunkMetadata {
  tenant?: string
  doc_type?: string
  source?: string
  pii_flag?: boolean
  timestamp?: string
  namespace_id?: string
}

export interface QueryResponse {
  id: string
  query: string
  response: string
  sources: Source[]
  timestamp: string
  processing: boolean
  azureUsed?: boolean
}

export interface Source {
  documentId: string
  documentName: string
  chunkId: string
  content: string
  relevanceScore: number
  azureScore?: number
  semanticCaption?: string
  semanticRerankerScore?: number
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: Source[]
  azureUsed?: boolean
}

export interface AgentMetrics {
  faithfulnessScore?: number
  relevanceScore?: number
  complexity?: string
  totalDuration?: number
}


export interface AzureConfig {
  openai: {
    endpoint: string
    apiKey: string
    deploymentName: string
    embeddingDeploymentName: string
    apiVersion: string
    enableStreaming?: boolean
    enableStoredCompletions?: boolean
    // Responses API (v1) configuration
    useResponsesApi?: boolean
    responsesModel?: string
    responsesStore?: boolean
    responsesBackground?: boolean
    responsesTimeoutMs?: number
    responsesApiVersion?: string
    responsesFallbackEnabled?: boolean
  }
  search: {
    endpoint: string
    apiKey: string
    indexName: string
    apiVersion: string
    namespace?: string
    semanticConfiguration?: {
      enabled: boolean
      configName: string
      prioritizeTitle: boolean
      prioritizeKeywords: boolean
    }
    vectorCompression?: {
      enabled: boolean
      method: 'scalar' | 'binary'
    }
    vectorDimensions?: number
    customScoring?: {
      enabled: boolean
      recencyWeight: number
      lengthWeight: number
      metadataWeight: number
    }
    hybridSearch?: {
      enabled: boolean
      maxTextRecallSize: number
      enableRRF: boolean
      enableSemanticReranker: boolean
    }
    contextCompression?: {
      enabled: boolean
      method: 'llmlingua' | 'extractive' | 'none'
      compressionRatio: number
    }
  }
}

export interface AzureConnectionStatus {
  openai: 'connected' | 'disconnected' | 'error' | 'testing'
  search: 'connected' | 'disconnected' | 'error' | 'testing'
  lastTested?: string
  errors?: {
    openai?: string
    search?: string
  }
}

export interface AzureSearchDocument {
  id: string
  content: string
  contentVector: number[]
  documentId: string
  documentName: string
  chunkIndex: number
  namespaceId?: string
  metadata?: Record<string, unknown>
}

export interface AzureSearchResult {
  value: AzureSearchDocument[]
  count?: number
}

export interface GitHubRepo {
  owner: string
  repo: string
  branch?: string
  path?: string
  token?: string
}

export interface WebsiteConfig {
  url: string
  maxDepth?: number
  maxPages?: number
  includePatterns?: string[]
  excludePatterns?: string[]
}

export interface DropboxConfig {
  accessToken: string
  path?: string
}

export interface OneDriveConfig {
  accessToken: string
  path?: string
}

export interface IntegrationSource {
  id: string
  type: 'github' | 'website' | 'dropbox' | 'onedrive'
  name: string
  config: GitHubRepo | WebsiteConfig | DropboxConfig | OneDriveConfig
  lastSynced?: string
  documentCount: number
  status: 'active' | 'syncing' | 'error' | 'paused'
  errorMessage?: string
}

export interface SavedAzureConfig {
  id: string
  name: string
  description?: string
  config: AzureConfig
  createdAt: string
  updatedAt: string
}

// OAuth/WebSocket/SSE Contracts
export interface OAuthCallbackPayload {
  provider: 'github' | 'dropbox' | 'onedrive'
  code: string
  state: string
  codeVerifier?: string
  redirectUri: string
  clientId: string
}

export interface TelemetryEvent {
  type: 'web_vitals' | 'error' | 'performance' | 'user_interaction'
  timestamp: string
  data: Record<string, unknown>
  correlationId?: string
}

export interface WorkflowUpdateEvent {
  event: 'workflow_start' | 'workflow_step' | 'workflow_complete' | 'workflow_error'
  runId: string
  stepId?: string
  agent?: string
  status: 'running' | 'completed' | 'failed'
  message?: string
  metadata?: Record<string, unknown>
}

export interface SSEEnvelope {
  id: string
  event: string
  data: string
  retry?: number
}

export interface WebSocketMessage {
  type: 'query' | 'workflow_update' | 'telemetry' | 'ping'
  payload: unknown
  correlationId: string
  timestamp: string
}
