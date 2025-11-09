import { Source, Document } from '@/types'
import { AzureSearchService } from '@/lib/azure-search'

/**
 * VectorStore abstraction - unified interface for retrieval
 * Read-only by design; indexing remains in AzureServiceManager
 */
export interface VectorStore {
  query(options: {
    queryText: string
    queryEmbedding?: number[]
    topK: number
    namespace: string
    strategy: 'vector' | 'keyword' | 'hybrid'
  }): Promise<{
    sources: Source[]
    metadata: {
      storeType: 'azure' | 'in-memory'
      latencyMs: number
    }
  }>
}

/**
 * Azure Search-backed vector store
 * Thin wrapper around existing AzureSearchService
 */
export class AzureSearchVectorStore implements VectorStore {
  constructor(private searchService: AzureSearchService) {}

  async query(options: {
    queryText: string
    queryEmbedding?: number[]
    topK: number
    namespace: string
    strategy: 'vector' | 'keyword' | 'hybrid'
  }): Promise<{
    sources: Source[]
    metadata: { storeType: 'azure'; latencyMs: number }
  }> {
    const startTime = Date.now()
    let sources: Source[] = []

    try {
      switch (options.strategy) {
        case 'vector': {
          if (!options.queryEmbedding || options.queryEmbedding.length === 0) {
            throw new Error('Vector search requires queryEmbedding')
          }
          sources = await this.searchService.vectorSearch(
            options.queryEmbedding,
            options.topK,
            options.namespace
          )
          break
        }
        case 'keyword': {
          sources = await this.searchService.keywordSearch(
            options.queryText,
            options.topK,
            options.namespace
          )
          break
        }
        case 'hybrid': {
          if (!options.queryEmbedding || options.queryEmbedding.length === 0) {
            throw new Error('Hybrid search requires queryEmbedding')
          }
          // Use Azure's native hybrid search - single call, no client fusion
          sources = await this.searchService.semanticHybridSearch(
            options.queryText,
            options.queryEmbedding,
            options.topK,
            options.namespace
          )
          break
        }
      }

      return {
        sources,
        metadata: {
          storeType: 'azure',
          latencyMs: Date.now() - startTime
        }
      }
    } catch (error) {
      throw new Error(
        `Azure vector store query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

/**
 * In-memory vector store
 * Delegates to existing findRelevantChunksLocal
 *
 * Namespace filtering: permissive by default for backward compatibility.
 * Accepts chunks without namespace_id OR matching the specified namespace.
 * For strict multi-tenant isolation, this should be tightened.
 */
export class InMemoryVectorStore implements VectorStore {
  constructor(private documents: Document[]) {}

  async query(options: {
    queryText: string
    queryEmbedding?: number[]
    topK: number
    namespace: string
    strategy: 'vector' | 'keyword' | 'hybrid'
  }): Promise<{
    sources: Source[]
    metadata: { storeType: 'in-memory'; latencyMs: number }
  }> {
    const startTime = Date.now()

    // Filter documents by namespace (permissive for backward compatibility)
    const namespacedDocs = this.documents.filter(doc => {
      if (!doc.chunks || doc.chunks.length === 0) return false
      return doc.chunks.some(
        chunk =>
          !chunk.metadata?.namespace_id ||
          chunk.metadata.namespace_id === options.namespace
      )
    })

    // Import findRelevantChunksLocal dynamically to avoid circular dependency
    const { findRelevantChunksLocal } = await import('@/lib/rag')

    const sources = await findRelevantChunksLocal(
      options.queryText,
      namespacedDocs,
      options.topK,
      options.strategy,
      { namespaceId: options.namespace }
    )

    return {
      sources,
      metadata: {
        storeType: 'in-memory',
        latencyMs: Date.now() - startTime
      }
    }
  }
}