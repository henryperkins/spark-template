/**
 * Shared execution context for agent orchestration.
 * Enables KB-aware decisions, phase tracking, and budget enforcement.
 */

import type { Document } from '@/types'
import type { QueryClassification } from './query-classifier'
import type { QueryPlan } from './query-planner'
import type { RoutingDecision } from './routing-agent'
import type { ValidationResult } from './critic-agent'
import type { ReActResult } from './react-agent'
import type { QueryExpansion } from './query-expansion'
import { classifyContentTypesForChunks } from './document-analyzer'

/**
 * Knowledge base characteristics extracted from documents.
 * Enables agents to make KB-aware decisions.
 */
export interface KBContext {
  /** Total number of documents in KB */
  documentCount: number

  /** Total number of chunks across all documents */
  chunkCount: number

  /** Whether embeddings are available for vector search */
  hasEmbeddings: boolean

  /** Percentage of chunks with embeddings (0-1) */
  embeddingCoverage: number

  /** Average chunk length in characters */
  avgChunkLength: number

  /** Dominant content types in KB */
  contentTypes: {
    code: number      // chunks with code patterns (0-1)
    prose: number     // narrative text (0-1)
    technical: number // technical documentation (0-1)
  }

  /** Per-document content characteristics */
  documents: Array<{
    id: string
    name: string
    chunkCount: number
    hasEmbeddings: boolean
    embeddingCoverage: number
    contentTypes: {
      code: number
      prose: number
      technical: number
    }
    azureIndexed: boolean
  }>

  /** Main topics extracted from KB (if available) */
  topics?: string[]

  /** KB fingerprint for cache invalidation */
  fingerprint: string

  /** Whether Azure indexing is configured */
  azureIndexed: boolean
}

/**
 * Retrieval phase metadata returned by RAG layer.
 */
export interface RetrievalMetadata {
  /** Strategy that was actually executed */
  strategy: 'vector' | 'keyword' | 'hybrid'

  /** Number of sources retrieved */
  sourceCount: number

  /** Average relevance score of sources */
  avgRelevanceScore: number

  /** Retrieval duration in ms */
  duration: number

  /** Whether Azure fallback occurred */
  degraded: boolean

  /** Reason for degradation (if degraded) */
  degradationReason?: string
}

/**
 * LLM call metadata for cost tracking.
 */
export interface LLMCallMetadata {
  /** Model used for this call */
  model: string

  /** Provider used (azure or worker) */
  provider: 'azure' | 'worker'

  /** Prompt tokens consumed */
  promptTokens: number

  /** Completion tokens generated */
  completionTokens: number

  /** Total tokens (prompt + completion) */
  totalTokens: number

  /** Estimated cost in USD */
  estimatedCost: number

  /** Temperature parameter */
  temperature?: number

  /** Max tokens parameter */
  maxTokens?: number

  /** Call duration in ms */
  duration: number
}

/**
 * Token budget for query execution.
 */
export interface TokenBudget {
  /** Total token budget for query */
  total: number

  /** Remaining tokens in budget */
  remaining: number

  /** Tokens consumed so far */
  consumed: number

  /** Estimated cost consumed (USD) */
  costConsumed: number

  /** Whether budget is exhausted */
  exhausted: boolean
}

/**
 * Time budget for query execution phases.
 */
export interface TimeBudget {
  /** Total time budget in ms */
  total: number

  /** Remaining time in ms */
  remaining: number

  /** Time consumed in ms */
  consumed: number

  /** Whether budget is exhausted */
  exhausted: boolean

  /** Time budget per phase (ms) */
  phases: {
    classification: number
    routing: number
    planning: number
    retrieval: number
    generation: number
    validation: number
    refinement: number
    expansion: number
  }
}

/**
 * Phase timing data for performance profiling.
 */
export interface PhaseTimings {
  classification?: number
  routing?: number
  planning?: number
  retrieval?: number
  generation?: number
  validation?: number
  refinement?: number
  expansion?: number
}

/**
 * Warnings accumulated during execution.
 */
export interface ExecutionWarning {
  phase: string
  code: 'budget_exceeded' | 'degraded_mode' | 'fallback_used' | 'cache_miss' | 'partial_results'
  message: string
  timestamp: string
}

/**
 * Complete execution context passed through agent pipeline.
 * This is the single source of truth for query execution state.
 */
export interface QueryExecutionContext {
  /** Unique run identifier */
  runId: string

  /** Original user query */
  query: string

  /** KB characteristics */
  kb: KBContext

  /** Token budget tracking */
  tokenBudget: TokenBudget

  /** Time budget tracking */
  timeBudget: TimeBudget

  /** Phase timing data */
  phaseTimings: PhaseTimings

  /** LLM calls made during execution */
  llmCalls: LLMCallMetadata[]

  /** Query classification result (set by ClassifierAgent) */
  classification?: QueryClassification

  /** Query plan (set by PlannerAgent if needed) */
  plan?: QueryPlan

  /** Routing decision (set by RoutingAgent) */
  routing?: RoutingDecision

  /** Retrieval metadata (set by retrieval phase) */
  retrievalMetadata?: RetrievalMetadata

  /** Validation result (set by CriticAgent) */
  validation?: ValidationResult

  /** Refinement result (set by ReActAgent) */
  refinement?: ReActResult

  /** Query expansion result (set by ExpansionAgent) */
  expansion?: QueryExpansion

  /** Warnings collected during execution */
  warnings: ExecutionWarning[]

  /** Whether any Azure fallback occurred */
  azureFallback: boolean

  /** Session metadata (optional) */
  session?: {
    userId?: string
    sessionId?: string
    conversationHistory?: number // number of previous queries in session
  }
}

/**
 * Build KB context from document collection.
 * Analyzes documents to extract KB characteristics.
 */
export function buildKBContext(documents: Document[]): KBContext {
  if (documents.length === 0) {
    return {
      documentCount: 0,
      chunkCount: 0,
      hasEmbeddings: false,
      embeddingCoverage: 0,
      avgChunkLength: 0,
      contentTypes: { code: 0, prose: 0, technical: 0 },
      documents: [],
      fingerprint: 'empty',
      azureIndexed: false
    }
  }

  // Count chunks and analyze embeddings
  let totalChunks = 0
  let chunksWithEmbeddings = 0
  let totalChunkLength = 0
  let codeChunks = 0
  let proseChunks = 0
  let technicalChunks = 0
  let azureIndexedCount = 0

  const perDocument: KBContext['documents'] = []

  for (const doc of documents) {
    if (doc.azureIndexed) {
      azureIndexedCount++
    }

    if (!doc.chunks || doc.chunks.length === 0) continue

    // Per-document stats
    const docChunkCount = doc.chunks.length
    let docChunksWithEmbeddings = 0
    let docTotalLength = 0

    // Content type classification per document via helper
    const docContents = doc.chunks.map(c => c.content)
    const docTypes = classifyContentTypesForChunks(docContents)

    for (const chunk of doc.chunks) {
      totalChunks++
      totalChunkLength += chunk.content.length
      docTotalLength += chunk.content.length

      // Check for embeddings
      if (chunk.embedding || chunk.azureEmbedding) {
        chunksWithEmbeddings++
        docChunksWithEmbeddings++
      }
    }

    // Fill aggregated counters from per-doc breakdown proportionally
    // Multiply doc breakdown by its chunk count to approximate KB-level counts
    codeChunks += Math.round(docTypes.code * docChunkCount)
    proseChunks += Math.round(docTypes.prose * docChunkCount)
    technicalChunks += Math.round(docTypes.technical * docChunkCount)

    perDocument.push({
      id: doc.id,
      name: doc.name,
      chunkCount: docChunkCount,
      hasEmbeddings: docChunksWithEmbeddings > 0,
      embeddingCoverage: docChunkCount > 0 ? docChunksWithEmbeddings / docChunkCount : 0,
      contentTypes: docTypes,
      azureIndexed: Boolean(doc.azureIndexed)
    }
  )}

  const embeddingCoverage = totalChunks > 0 ? chunksWithEmbeddings / totalChunks : 0
  const avgChunkLength = totalChunks > 0 ? totalChunkLength / totalChunks : 0

  // Normalize content type percentages
  const totalClassified = codeChunks + proseChunks + technicalChunks || 1
  const contentTypes = {
    code: codeChunks / totalClassified,
    prose: proseChunks / totalClassified,
    technical: technicalChunks / totalClassified
  }

  // Generate fingerprint from document IDs and chunk counts
  const fingerprint = documents
    .map(doc => `${doc.id}:${doc.chunks?.length || 0}`)
    .sort()
    .join('|')
    .substring(0, 64) || 'no-docs'

  return {
    documentCount: documents.length,
    chunkCount: totalChunks,
    hasEmbeddings: embeddingCoverage > 0,
    embeddingCoverage,
    avgChunkLength: Math.round(avgChunkLength),
    contentTypes,
    documents: perDocument,
    fingerprint,
    azureIndexed: azureIndexedCount > 0
  }
}

/**
 * Initialize query execution context.
 */
export function createQueryExecutionContext(
  runId: string,
  query: string,
  kb: KBContext,
  options?: {
    tokenBudget?: number
    timeBudgetMs?: number
    session?: QueryExecutionContext['session']
  }
): QueryExecutionContext {
  const tokenTotal = options?.tokenBudget || 50000 // Default 50k tokens
  const timeTotal = options?.timeBudgetMs || 60000 // Default 60s

  return {
    runId,
    query,
    kb,
    tokenBudget: {
      total: tokenTotal,
      remaining: tokenTotal,
      consumed: 0,
      costConsumed: 0,
      exhausted: false
    },
    timeBudget: {
      total: timeTotal,
      remaining: timeTotal,
      consumed: 0,
      exhausted: false,
      phases: {
        classification: 5000,
        routing: 3000,
        planning: 8000,
        retrieval: 10000,
        generation: 15000,
        validation: 8000,
        refinement: 20000,
        expansion: 8000
      }
    },
    phaseTimings: {},
    llmCalls: [],
    warnings: [],
    azureFallback: false,
    session: options?.session
  }
}

/**
 * Record phase timing in context.
 */
export function recordPhaseTime(
  context: QueryExecutionContext,
  phase: keyof PhaseTimings,
  duration: number
): void {
  context.phaseTimings[phase] = duration
  context.timeBudget.consumed += duration
  context.timeBudget.remaining = Math.max(0, context.timeBudget.total - context.timeBudget.consumed)
  context.timeBudget.exhausted = context.timeBudget.remaining === 0
}

/**
 * Record LLM call in context for token tracking.
 */
export function recordLLMCall(
  context: QueryExecutionContext,
  metadata: LLMCallMetadata
): void {
  context.llmCalls.push(metadata)
  context.tokenBudget.consumed += metadata.totalTokens
  context.tokenBudget.costConsumed += metadata.estimatedCost
  context.tokenBudget.remaining = Math.max(0, context.tokenBudget.total - context.tokenBudget.consumed)
  context.tokenBudget.exhausted = context.tokenBudget.remaining === 0
}

/**
 * Add warning to context.
 */
export function addWarning(
  context: QueryExecutionContext,
  phase: string,
  code: ExecutionWarning['code'],
  message: string
): void {
  context.warnings.push({
    phase,
    code,
    message,
    timestamp: new Date().toISOString()
  })
}

/**
 * Check if token budget allows for a call.
 */
export function canAffordTokens(
  context: QueryExecutionContext,
  estimatedTokens: number
): boolean {
  return context.tokenBudget.remaining >= estimatedTokens
}

/**
 * Check if time budget allows for a phase.
 */
export function canAffordTime(
  context: QueryExecutionContext,
  phase: keyof TimeBudget['phases']
): boolean {
  const phaseAllocation = context.timeBudget.phases[phase]
  return context.timeBudget.remaining >= phaseAllocation
}

/**
 * Get model pricing for cost estimation.
 * Prices in USD per 1M tokens.
 */
export function getModelPricing(model: string): { prompt: number; completion: number } {
  const pricing: Record<string, { prompt: number; completion: number }> = {
    'gpt-4': { prompt: 30, completion: 60 },
    'gpt-4-turbo': { prompt: 10, completion: 30 },
    'gpt-4o': { prompt: 5, completion: 15 },
    'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
    // Common alternates and newer variants
    'gpt-4.1': { prompt: 5, completion: 15 },
    'gpt-4.1-mini': { prompt: 0.15, completion: 0.6 },
    'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
    'text-embedding-ada-002': { prompt: 0.1, completion: 0 },
    'text-embedding-3-small': { prompt: 0.02, completion: 0 },
    'text-embedding-3-large': { prompt: 0.13, completion: 0 }
  }

  // Exact hit
  if (pricing[model]) return pricing[model]

  // Heuristic fallback for common aliases/suffixes (Azure or vendor-specific names)
  const m = model.toLowerCase()
  const aliasMap: Array<{ match: (s: string) => boolean; key: keyof typeof pricing }> = [
    { match: s => s.includes('gpt-4o-mini'), key: 'gpt-4o-mini' },
    { match: s => s.includes('gpt-4o'), key: 'gpt-4o' },
    { match: s => s.includes('gpt-4.1-mini'), key: 'gpt-4.1-mini' },
    { match: s => s.includes('gpt-4.1'), key: 'gpt-4.1' },
    { match: s => s.includes('gpt-4-turbo'), key: 'gpt-4-turbo' },
    { match: s => s.includes('gpt-3.5'), key: 'gpt-3.5-turbo' },
    { match: s => s.includes('text-embedding-3-large'), key: 'text-embedding-3-large' },
    { match: s => s.includes('text-embedding-3-small'), key: 'text-embedding-3-small' },
    { match: s => s.includes('text-embedding-ada-002') || s.includes('ada-002'), key: 'text-embedding-ada-002' }
  ]
  const alias = aliasMap.find(a => a.match(m))
  if (alias) {
    console.warn(`[pricing] Using alias pricing "${String(alias.key)}" for model "${model}".`)
    return pricing[alias.key]
  }

  // Default to gpt-4 pricing and warn
  console.warn(`[pricing] Unknown model "${model}". Falling back to gpt-4 pricing for estimates.`)
  return pricing['gpt-4']
}

/**
 * Calculate cost for an LLM call.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = getModelPricing(model)
  const promptCost = (promptTokens / 1_000_000) * pricing.prompt
  const completionCost = (completionTokens / 1_000_000) * pricing.completion
  return promptCost + completionCost
}

/**
 * Get execution summary from context.
 */
export interface ExecutionSummary {
  totalDuration: number
  totalTokens: number
  totalCost: number
  llmCallCount: number
  warningCount: number
  azureFallback: boolean
  budgetUtilization: {
    tokens: number // 0-1
    time: number   // 0-1
  }
  phaseBreakdown: Record<string, number>
}

export function getExecutionSummary(context: QueryExecutionContext): ExecutionSummary {
  const totalDuration = Object.values(context.phaseTimings).reduce((sum, t) => sum + (t || 0), 0)
  const totalTokens = context.tokenBudget.consumed
  const totalCost = context.tokenBudget.costConsumed

  // Convert PhaseTimings to Record<string, number>
  const phaseBreakdown: Record<string, number> = {}
  for (const [key, value] of Object.entries(context.phaseTimings)) {
    if (value !== undefined) {
      phaseBreakdown[key] = value
    }
  }

  return {
    totalDuration,
    totalTokens,
    totalCost,
    llmCallCount: context.llmCalls.length,
    warningCount: context.warnings.length,
    azureFallback: context.azureFallback,
    budgetUtilization: {
      tokens: context.tokenBudget.total > 0 ? context.tokenBudget.consumed / context.tokenBudget.total : 0,
      time: context.timeBudget.total > 0 ? context.timeBudget.consumed / context.timeBudget.total : 0
    },
    phaseBreakdown
  }
}
