import { AzureConfig, AzureConnectionStatus, Document, DocumentChunk, Source, AzureSearchDocument } from '@/types'
import { AzureOpenAIService } from './azure-openai'
import { AzureSearchService } from './azure-search'

export class AzureServiceManager {
  private openaiService: AzureOpenAIService | null = null
  private searchService: AzureSearchService | null = null
  private config: AzureConfig | null = null

  async initialize(config: AzureConfig): Promise<AzureConnectionStatus> {
    this.config = config
    this.openaiService = new AzureOpenAIService(config.openai)
    this.searchService = new AzureSearchService(config.search)

    const status: AzureConnectionStatus = {
      openai: 'testing',
      search: 'testing',
      lastTested: new Date().toISOString(),
      errors: {}
    }

    // Test OpenAI connection
    try {
      const openaiResult = await this.openaiService.testConnection()
      status.openai = openaiResult.success ? 'connected' : 'error'
      if (!openaiResult.success) {
        status.errors!.openai = openaiResult.error
      }
    } catch (error) {
      status.openai = 'error'
      status.errors!.openai = error instanceof Error ? error.message : 'Unknown error'
    }

    // Test Search connection
    try {
      const searchResult = await this.searchService.testConnection()
      status.search = searchResult.success ? 'connected' : 'error'
      if (!searchResult.success) {
        status.errors!.search = searchResult.error
      }
    } catch (error) {
      status.search = 'error'
      status.errors!.search = error instanceof Error ? error.message : 'Unknown error'
    }

    return status
  }

  isConfigured(): boolean {
    return this.openaiService !== null && this.searchService !== null
  }

  hasOpenAI(): boolean {
    return this.openaiService !== null
  }

  getSearchService(): AzureSearchService | null {
    return this.searchService
  }

  async tryGenerateQueryEmbedding(query: string): Promise<number[] | null> {
    if (!this.openaiService) {
      return null
    }
    try {
      return await this.openaiService.generateEmbedding(query)
    } catch {
      return null
    }
  }

  async processDocumentWithAzure(document: Document): Promise<Document> {
    if (!this.isConfigured()) {
      throw new Error('Azure services not configured')
    }

    try {
      const updatedDocument = { ...document, processingStatus: 'processing' as const }

      // Generate embeddings for all chunks
      const texts = document.chunks.map(chunk => chunk.content)
      const embeddings = await this.openaiService!.generateBatchEmbeddings(texts)

      // Update chunks with embeddings
      const updatedChunks: DocumentChunk[] = document.chunks.map((chunk, index) => ({
        ...chunk,
        azureEmbedding: embeddings[index],
        vectorId: `${chunk.id}-vector`
      }))

      // Prepare documents for Azure Search indexing
      const searchDocuments: AzureSearchDocument[] = updatedChunks.map(chunk => ({
        id: chunk.vectorId!,
        content: chunk.content,
        contentVector: chunk.azureEmbedding!,
        documentId: document.id,
        documentName: document.name,
        chunkIndex: chunk.chunkIndex
      }))

      // Index in Azure Search
      const indexResult = await this.searchService!.indexDocuments(searchDocuments)

      if (!indexResult.success) {
        throw new Error(`Indexing failed: ${indexResult.error}`)
      }

      return {
        ...updatedDocument,
        chunks: updatedChunks,
        azureIndexed: true,
        processingStatus: 'completed'
      }
    } catch (error) {
      console.error('Error processing document with Azure:', error)
      return {
        ...document,
        processingStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async searchWithAzure(
    query: string,
    strategy: 'vector' | 'keyword' | 'hybrid' = 'hybrid'
  ): Promise<Source[]> {
    if (!this.isConfigured()) {
      throw new Error('Azure services not configured')
    }

    try {
      let results: Source[] = []

      if (strategy === 'keyword') {
        // Primary: keyword search
        try {
          results = await this.searchService!.keywordSearch(query, 5)
        } catch {
          // continue to vector fallback
        }
        // Fallback: vector if no hits
        if (results.length === 0) {
          const queryEmbedding = await this.openaiService!.generateEmbedding(query)
          try {
            results = await this.searchService!.vectorSearch(queryEmbedding, 5)
          } catch {
            // final fallback: hybrid
            try {
              results = await this.searchService!.semanticHybridSearch(query, queryEmbedding, 5)
            } catch {
              // swallow; handled below
            }
          }
        }
        return results
      }

      // For 'vector' and 'hybrid', compute embedding once
      const queryEmbedding = await this.openaiService!.generateEmbedding(query)

      if (strategy === 'vector') {
        try {
          results = await this.searchService!.vectorSearch(queryEmbedding, 5)
        } catch {
          // continue to keyword fallback
        }
        if (results.length === 0) {
          try {
            results = await this.searchService!.keywordSearch(query, 5)
          } catch {
            // swallow
          }
        }
        return results
      }

      // strategy === 'hybrid'
      try {
        results = await this.searchService!.semanticHybridSearch(query, queryEmbedding, 5)
      } catch {
        // continue to keyword fallback
      }
      if (results.length === 0) {
        try {
          results = await this.searchService!.keywordSearch(query, 5)
        } catch {
          // continue to vector fallback
        }
      }
      if (results.length === 0) {
        try {
          results = await this.searchService!.vectorSearch(queryEmbedding, 5)
        } catch {
          // swallow
        }
      }
      return results
    } catch (error) {
      console.error('Error searching with Azure:', error)
      throw error
    }
  }

  async generateResponseWithAzure(query: string, sources: Source[]): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Azure services not configured')
    }

    try {
      const context = sources
        .map((source, index) => `[${index + 1}] ${source.content}`)
        .join('\n\n')

      return await this.openaiService!.generateRAGResponse(query, context)
    } catch (error) {
      console.error('Error generating response with Azure:', error)
      throw error
    }
  }

  async deleteDocumentFromAzure(documentId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Azure services not configured' }
    }

    try {
      return await this.searchService!.deleteDocumentChunks(documentId)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  getConnectionStatus(): AzureConnectionStatus | null {
    if (!this.isConfigured()) {
      return null
    }

    return {
      openai: 'connected',
      search: 'connected',
      lastTested: new Date().toISOString()
    }
  }

  async generateCompletion(
    messages: Array<{ role: string; content: string }> | string,
    options?: {
      maxTokens?: number
      temperature?: number
      topP?: number
      responseFormat?: 'text' | 'json_object'
    }
  ): Promise<string> {
    if (!this.openaiService) {
      throw new Error('Azure OpenAI service not configured')
    }

    return this.openaiService.generateCompletion(messages, options)
  }
}

// Singleton instance
export const azureServiceManager = new AzureServiceManager()
