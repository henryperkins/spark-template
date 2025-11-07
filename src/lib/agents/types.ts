// Shared agent result envelope and common types for Layer 4–5

export interface AgentFailure {
  ok: false
  error: {
    type: 'llm' | 'kv' | 'parse' | 'validation' | 'logic' | 'unknown'
    code: string
    message: string
    retriable: boolean
  }
  meta?: Record<string, unknown>
}

export interface AgentSuccess<T> {
  ok: true
  value: T
  meta?: Record<string, unknown>
}

export type AgentResult<T> = AgentSuccess<T> | AgentFailure

// Document analysis types
export type ChunkingStrategy = 'paragraph' | 'sentence' | 'semantic' | 'fixed'

export interface ChunkingDecision {
  strategy: ChunkingStrategy
  chunkSize: number
  overlap: number
  reasoning: string
}

export interface DocAnalysisProgress {
  runId: string
  docSlug: string
  percent: number
  phase: 'init' | 'analyzing' | 'caching' | 'complete' | 'error'
  message?: string
  updatedAt: string
}

export interface DocAnalysisPing {
  runId: string
  status: 'started' | 'running' | 'idle' | 'complete' | 'error'
  updatedAt: string
}

