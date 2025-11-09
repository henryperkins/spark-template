import { Source, Document } from '@/types'
import { AzureSearchVectorStore, InMemoryVectorStore, type VectorStore } from '@/lib/vector-store'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cacheManager } from '@/lib/cache-manager'

export interface HybridSearchContext {
  namespace: string
  maxResults: number
  normalizeScores?: boolean
  // When true, bypass Azure even if configured and use in-memory retrieval
  forceLocal?: boolean
  // Optional: reuse Azure results from a preflight to avoid duplicate calls
  precomputedAzureSources?: Source[]
}

export interface HybridSearchMetadata {
  strategy: 'vector' | 'keyword' | 'hybrid'
  storeType: 'azure' | 'in-memory'
  azureFallback: boolean
  latencyMs: number
  // Optional observability fields
  vectorSearchLatencyMs?: number
  keywordSearchLatencyMs?: number
  fusionLatencyMs?: number
}

export interface HybridSearchResult {
  sources: Source[]
  metadata: HybridSearchMetadata
}

/**
 * Centralized hybrid search orchestrator
 * Delegates to VectorStore abstraction
 * Preserves cache behavior (keyed by query/strategy/namespace/maxResults)
 */
export async function hybridSearch(
  query: string,
  documents: Document[],
  strategy: 'vector' | 'keyword' | 'hybrid',
  context: HybridSearchContext
): Promise<HybridSearchResult> {
  const startTime = Date.now()
  let azureFallback = false

  // Determine store intent and document fingerprint for cache key isolation
  const storeIntent: 'azure' | 'in-memory' =
    context.forceLocal
      ? 'in-memory'
      : (azureServiceManager.isConfigured() && azureServiceManager.getSearchService() ? 'azure' : 'in-memory')

  const docFingerprint = buildDocumentFingerprint(documents, context.namespace)

  // Cache lookup (separate entries per document state and store intent)
  const cacheKey = buildCacheKey(query, strategy, context, docFingerprint, storeIntent)
  const cached = await cacheManager.get<HybridSearchResult>(cacheKey)
  if (cached) {
    return cached
  }

  // Decide store
  let store: VectorStore
  let storeType: 'azure' | 'in-memory'
  if (context.forceLocal) {
    store = new InMemoryVectorStore(documents)
    storeType = 'in-memory'
  } else if (azureServiceManager.isConfigured() && azureServiceManager.getSearchService()) {
    store = new AzureSearchVectorStore(azureServiceManager.getSearchService()!)
    storeType = 'azure'
  } else {
    store = new InMemoryVectorStore(documents)
    storeType = 'in-memory'
  }

  let sources: Source[] = []

  if (context.precomputedAzureSources && context.precomputedAzureSources.length > 0) {
    // Reuse preflight Azure results to avoid duplicate retrieval/token spend
    sources = context.precomputedAzureSources.slice(0, context.maxResults)
    storeType = 'azure'
  } else {
    try {
      // Embedding only needed for vector/hybrid
      let queryEmbedding: number[] | undefined
      if (strategy === 'vector' || strategy === 'hybrid') {
        queryEmbedding = (await azureServiceManager.tryGenerateQueryEmbedding(query)) || undefined
        if (!queryEmbedding && strategy === 'vector') {
          // If we explicitly asked for vector but can't embed, treat as retrieval failure
          throw new Error('Failed to generate embedding for vector search')
        }
      }

      const result = await store.query({
        queryText: query,
        queryEmbedding,
        topK: context.maxResults,
        namespace: context.namespace,
        strategy
      })
      sources = result.sources
      storeType = result.metadata.storeType
    } catch (primaryErr) {
      console.warn('[hybrid-search] primary retrieval failed; attempting fallback:', primaryErr)
      azureFallback = true

      // Fallback: in-memory store using keyword/hybrid
      const fallbackStore = new InMemoryVectorStore(documents)
      const fallbackStrategies: Array<'vector' | 'keyword' | 'hybrid'> =
        strategy === 'vector' ? ['keyword', 'hybrid'] : ['keyword']

      for (const alt of fallbackStrategies) {
        try {
          const fallbackResult = await fallbackStore.query({
            queryText: query,
            // In-memory vector path depends on available embeddings on chunks; we don't compute query embedding here
            queryEmbedding: undefined,
            topK: context.maxResults,
            namespace: context.namespace,
            strategy: alt
          })
          if (fallbackResult.sources.length > 0) {
            sources = fallbackResult.sources
            storeType = 'in-memory'
            break
          }
        } catch (fallbackErr) {
          console.warn(`[hybrid-search] fallback strategy "${alt}" failed:`, fallbackErr)
        }
      }
    }
  }

  // Score normalization (local only)
  if (context.normalizeScores && sources.length > 0) {
    sources = normalizeScores(sources)
  }

  const finalAzureFallback = azureFallback || (azureServiceManager.isConfigured() && storeType !== 'azure')

  const out: HybridSearchResult = {
    sources,
    metadata: {
      strategy,
      storeType,
      azureFallback: finalAzureFallback,
      latencyMs: Date.now() - startTime
    }
  }

  // Avoid caching degraded fallback results to prevent locking in local answers during transient Azure outages
  if (!finalAzureFallback) {
    await cacheManager.set(cacheKey, out)
  }
  return out
}

function buildCacheKey(
  query: string,
  strategy: string,
  ctx: HybridSearchContext,
  docFp: string,
  storeIntent: 'azure' | 'in-memory'
): string {
  return `rag-query:${strategy}:${ctx.maxResults}:ns:${ctx.namespace}:store:${storeIntent}:docs:${docFp}:q:${hashString(query)}`
}

function buildDocumentFingerprint(docs: Document[], namespace?: string): string {
  try {
    const parts: string[] = []
    for (const d of docs) {
      const chunks = Array.isArray(d.chunks) ? d.chunks : []
      const count = chunks.filter(c => {
        const ns = (c as any).namespace || c.metadata?.namespace_id
        return !namespace || ns === namespace
      }).length
      parts.push(`${d.id}:${count}`)
    }
    parts.sort()
    const raw = parts.join('|') || 'none'
    return hashString(raw)
  } catch {
    return 'unknown'
  }
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}

function normalizeScores(sources: Source[]): Source[] {
  if (!sources.length) return sources
  const values = sources.map(s => s.relevanceScore ?? 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (!Number.isFinite(range) || range <= 0) {
    return sources.map(s => ({ ...s, relevanceScore: 1 }))
  }
  return sources.map(s => ({
    ...s,
    relevanceScore: (s.relevanceScore - min) / range
  }))
}