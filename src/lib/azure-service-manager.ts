import { AzureConfig, AzureConnectionStatus, Document, DocumentChunk, Source, AzureSearchDocument } from '@/types'
import { AzureOpenAIService } from './azure-openai'
import { errorTracking } from '@/lib/services/error-tracker'
import { AzureSearchService } from './azure-search'
import { intelligentChunkDocument } from './rag'

export class AzureServiceManager {
  private openaiService: AzureOpenAIService | null = null
  private searchService: AzureSearchService | null = null
  private config: AzureConfig | null = null

  async initialize(config: AzureConfig): Promise<AzureConnectionStatus> {
    this.config = config

    // Wire AzureOpenAIService with Responses API feature flags; all fields are optional and non-breaking.
    const openaiConfig = {
      ...config.openai,
      useResponsesApi:
        config.openai.useResponsesApi ??
        process.env.VITE_AZURE_USE_RESPONSES === 'true',
      responsesModel:
        config.openai.responsesModel ??
        process.env.VITE_AZURE_RESPONSES_MODEL,
      responsesStore:
        config.openai.responsesStore ??
        (process.env.VITE_AZURE_RESPONSES_STORE === 'true'
          ? true
          : undefined),
      // IMPORTANT:
      // - Do NOT enable background by default for synchronous Responses API calls.
      // - Background runs must use the explicit background task helpers that poll/retrieve.
      responsesBackground:
        config.openai.responsesBackground ??
        (process.env.VITE_AZURE_RESPONSES_BACKGROUND_DEFAULT === 'true'
          ? false
          : undefined),
      responsesTimeoutMs:
        config.openai.responsesTimeoutMs ??
        (process.env.VITE_AZURE_RESPONSES_TIMEOUT_MS
          ? Number(process.env.VITE_AZURE_RESPONSES_TIMEOUT_MS)
          : undefined),
      responsesApiVersion:
        config.openai.responsesApiVersion ??
        process.env.VITE_AZURE_RESPONSES_API_VERSION,
      responsesFallbackEnabled:
        (config.openai as any).responsesFallbackEnabled ??
        (process.env.VITE_AZURE_RESPONSES_FALLBACK_ENABLED === 'true' ? true : undefined)
    }

    this.openaiService = new AzureOpenAIService(openaiConfig as any)
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

  getNamespaceId(): string | undefined {
    return this.config?.search?.namespace
  }

  /**
   * Stream chat completions from Azure OpenAI.
   * Returns an async iterable of text chunks. Uses the AzureOpenAIService streaming mode
   * and bridges onChunk callbacks into an async generator.
   */
  generateStream(
    messages: Array<{ role: string; content: string }> | string,
    options?: {
      maxTokens?: number
      temperature?: number
      topP?: number
      responseFormat?: 'text' | 'json_object'
    }
  ): AsyncIterable<string> {
    if (!this.openaiService) {
      throw new Error('Azure OpenAI service not configured')
    }

    // Simple async queue to bridge callback -> async iterable
    const queue: string[] = []
    let done = false
    let errState: unknown | null = null
    let notify: (() => void) | null = null

    const enqueue = (chunk: string) => {
      if (typeof chunk === 'string' && chunk.length > 0) {
        queue.push(chunk)
        const n = notify
        if (n) n()
        notify = null
      }
    }

    // Kick off the streaming request (fire and forget; completion sets done flag)
    const startedAt = Date.now()
    ;(async () => {
      try {
        await this.openaiService!.generateCompletion(messages, {
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
          topP: options?.topP,
          responseFormat: options?.responseFormat,
          stream: true,
          onChunk: (c: string) => enqueue(c),
        })
      } catch (err) {
        // Capture error to propagate through the async iterator
        errState = err
        console.error('Azure streaming error:', err)
        try {
          errorTracking.record(err as Error, { type: 'llm', agent: 'AzureOpenAI', code: 'openai_stream_error' })
        } catch {
          // Ignore error tracking failures
        }
      } finally {
        done = true
        const duration = Date.now() - startedAt
        if (typeof console !== 'undefined') {
          console.debug('[azure-service-manager] stream completed', { durationMs: duration })
        }
        const fn = notify as unknown as (() => void) | null
        if (typeof fn === 'function') fn()
        notify = null
      }
    })()

    // The async iterator that yields chunks as they arrive
    const iterator: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
          async next(): Promise<IteratorResult<string>> {
            while (true) {
              // If an error occurred, surface it to the consumer
              if (errState) {
                throw errState
              }
              // yield queued chunks first
              if (queue.length > 0) {
                const value = queue.shift() as string
                return { value, done: false }
              }
              // if no more chunks will arrive, finish
              if (done) {
                return { value: undefined as unknown as string, done: true }
              }
              // wait for next chunk or completion
              await new Promise<void>((resolve) => {
                notify = resolve
              })
              // loop to re-check conditions
            }
          },
        }
      },
    }
    return iterator
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

  async processDocumentWithAzure(
    document: Document,
    onEmbeddingProgress?: (done: number, total: number) => void
  ): Promise<Document> {
    if (!this.isConfigured()) {
      throw new Error('Azure services not configured')
    }

    try {
      const updatedDocument = { ...document, processingStatus: 'processing' as const }

      const texts = document.chunks.map(chunk => chunk.content)
      const embeddings = await this.openaiService!.generateBatchEmbeddings(texts, onEmbeddingProgress)

      const updatedChunks: DocumentChunk[] = document.chunks.map((chunk, index) => ({
        ...chunk,
        azureEmbedding: embeddings[index],
        vectorId: `${chunk.id}-vector`
      }))

      const searchDocuments: AzureSearchDocument[] = updatedChunks.map(chunk => ({
        id: chunk.vectorId!,
        content: chunk.content,
        contentVector: chunk.azureEmbedding!,
        documentId: document.id,
        documentName: document.name,
        chunkIndex: chunk.chunkIndex
      }))

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

  /**
   * Update an existing document with new content:
   * - Re-chunks using the intelligent chunker
   * - In local mode: returns updated chunks only
   * - In Azure-configured mode: deletes old chunks, re-embeds, reindexes
   */
  async updateDocumentWithAzure(
    document: Document,
    newContent: string,
    options?: {
      onEmbeddingProgress?: (done: number, total: number) => void
      preserveMetadata?: boolean
    }
  ): Promise<Document> {
    const preserveMetadata = options?.preserveMetadata !== false

    try {
      const { chunks: baseChunks } = await intelligentChunkDocument(
        newContent,
        document.id,
        document.name
      )

      const newChunks: DocumentChunk[] = baseChunks.map(chunk => {
        const existing = document.chunks.find(c => c.chunkIndex === chunk.chunkIndex)
        const metadata =
          preserveMetadata && existing?.metadata
            ? { ...existing.metadata }
            : chunk.metadata

        return {
          ...chunk,
          metadata
        }
      })

      if (!this.isConfigured()) {
        return {
          ...document,
          chunks: newChunks,
          processed: true,
          azureIndexed: false,
          processingStatus: 'completed',
          errorMessage: undefined
        }
      }

      const deleteResult = await this.searchService!.deleteDocumentChunks(document.id)
      if (!deleteResult.success) {
        console.error(
          '[azure-service-manager] Failed to delete existing Azure Search chunks:',
          deleteResult.error
        )
        return {
          ...document,
          chunks: newChunks,
          processingStatus: 'error',
          errorMessage:
            deleteResult.error ?? 'Failed to delete existing Azure Search chunks'
        }
      }

      const texts = newChunks.map(c => c.content)
      const embeddings = await this.openaiService!.generateBatchEmbeddings(
        texts,
        options?.onEmbeddingProgress
      )

      const updatedChunks: DocumentChunk[] = newChunks.map((chunk, index) => ({
        ...chunk,
        azureEmbedding: embeddings[index],
        vectorId: `${chunk.id}-vector`
      }))

      const searchDocuments: AzureSearchDocument[] = updatedChunks.map(chunk => ({
        id: chunk.vectorId!,
        content: chunk.content,
        contentVector: chunk.azureEmbedding!,
        documentId: document.id,
        documentName: document.name,
        chunkIndex: chunk.chunkIndex
      }))

      const indexResult = await this.searchService!.indexDocuments(searchDocuments)
      if (!indexResult.success) {
        console.error(
          '[azure-service-manager] Failed to index updated document:',
          indexResult.error
        )
        return {
          ...document,
          chunks: updatedChunks,
          azureIndexed: false,
          processed: true,
          processingStatus: 'error',
          errorMessage: indexResult.error || 'Indexing failed'
        }
      }

      return {
        ...document,
        chunks: updatedChunks,
        processed: true,
        azureIndexed: true,
        processingStatus: 'completed',
        errorMessage: undefined
      }
    } catch (error) {
      console.error('Error updating document with Azure:', error)
      try {
        errorTracking.record(error as Error, {
          type: 'retrieval',
          agent: 'AzureUpdate',
          code: 'update_failed'
        })
      } catch {
        // ignore error-tracking failures
      }
      return {
        ...document,
        processingStatus: 'error',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown error during Azure document update'
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
      const start = Date.now()
      let results: Source[] = []
      let failures = 0

      const shortQuery = query.trim().split(/\s+/).filter(Boolean).length <= 2 && query.length <= 24
      const skipSemantic = shortQuery

      if (strategy === 'keyword') {
        // Primary: keyword search
        try {
          results = await this.searchService!.keywordSearch(query, 5)
        } catch {
          failures++
          // continue to vector fallback
        }
        // Fallback: vector if no hits
        if (results.length === 0) {
          const queryEmbedding = await this.openaiService!.generateEmbedding(query)
          try {
            results = await this.searchService!.vectorSearch(queryEmbedding, 5)
          } catch {
            failures++
            // final fallback: hybrid
            try {
              if (!skipSemantic) {
                results = await this.searchService!.semanticHybridSearch(query, queryEmbedding, 5)
              }
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
          failures++
          // continue to keyword fallback
        }
        if (results.length === 0) {
          try {
            results = await this.searchService!.keywordSearch(query, 5)
          } catch {
            failures++
            // swallow
          }
        }
        return results
      }

      // strategy === 'hybrid'
      try {
        if (!skipSemantic) {
          results = await this.searchService!.semanticHybridSearch(query, queryEmbedding, 5)
        }
      } catch {
        failures++
        // continue to keyword fallback
      }
      if (results.length === 0) {
        try {
          results = await this.searchService!.keywordSearch(query, 5)
        } catch {
          failures++
          // continue to vector fallback
        }
      }
      if (results.length === 0) {
        try {
          results = await this.searchService!.vectorSearch(queryEmbedding, 5)
        } catch {
          failures++
          // swallow
        }
      }
      // simple circuit breaker: if repeated failures, short-circuit subsequent attempts in the same request
      if (failures >= 3 && results.length === 0) {
        console.warn('[azure-service-manager] search attempts exceeded failure threshold; short-circuiting')
      }
      const duration = Date.now() - start
      if (typeof console !== 'undefined') {
        console.debug('[azure-service-manager] search duration(ms)', duration, { strategy, skipSemantic, failures, resultCount: results.length })
      }
      return results
    } catch (error) {
      console.error('Error searching with Azure:', error)
      throw error
    }
  }

  async generateResponseWithAzure(query: string, sources: Source[]): Promise<string> {
    if (!this.hasOpenAI()) {
      throw new Error('Azure OpenAI service not configured')
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

  async rebuildSearchIndex(config?: AzureConfig, vectorDimensions?: number): Promise<{ success: boolean; error?: string }> {
    try {
      if (config) {
        this.config = config
        this.searchService = new AzureSearchService(config.search)
      } else if (!this.searchService && this.config) {
        this.searchService = new AzureSearchService(this.config.search)
      }

      if (!this.searchService) {
        return { success: false, error: 'Azure Search service not configured' }
      }

      return await this.searchService.rebuildIndex(vectorDimensions)
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

  /**
   * Generate a completion and return usage metadata when available.
   * Falls back to text-only if the underlying service does not return usage.
   */
  async generateCompletionWithUsage(
    messages: Array<{ role: string; content: string }> | string,
    options?: {
      maxTokens?: number
      temperature?: number
      topP?: number
      responseFormat?: 'text' | 'json_object'
    }
  ): Promise<{ text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }>
  {
    if (!this.openaiService) {
      throw new Error('Azure OpenAI service not configured')
    }
    const startedAt = Date.now()
    if (options && (options as any).stream) {
      // streaming path does not yield usage reliably; delegate to standard method
      const text = await this.openaiService.generateCompletion(messages, options)
      const duration = Date.now() - startedAt
      console.debug('[azure-service-manager] completion (stream=true) duration(ms)', duration)
      return { text }
    }
    if (typeof (this.openaiService as any).generateCompletionWithUsage === 'function') {
      const result = await (this.openaiService as any).generateCompletionWithUsage(messages, options)
      const duration = Date.now() - startedAt
      if (result?.usage) {
        console.debug('[azure-service-manager] completion usage', { ...result.usage, durationMs: duration })
      } else {
        console.debug('[azure-service-manager] completion duration(ms)', duration)
      }
      return result
    }
    const text = await this.openaiService.generateCompletion(messages, options)
    const duration = Date.now() - startedAt
    console.debug('[azure-service-manager] completion duration(ms)', duration)
    return { text }
  }
}

// Singleton instance
export const azureServiceManager = new AzureServiceManager()
