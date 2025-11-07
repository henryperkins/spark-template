import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AzureServiceManager } from '../src/lib/azure-service-manager'
import type { AzureConfig, Document, DocumentChunk } from '../src/types'

// Mock dependencies
vi.mock('../src/lib/azure-openai', () => {
  return {
    AzureOpenAIService: vi.fn().mockImplementation(() => ({
      testConnection: vi.fn(async () => ({ success: true })),
      generateEmbedding: vi.fn(async (text: string) => new Array(1536).fill(0.1)),
      generateBatchEmbeddings: vi.fn(async (texts: string[], onProgress?: any) => {
        if (onProgress) {
          texts.forEach((_, i) => onProgress(i + 1, texts.length))
        }
        return texts.map(() => new Array(1536).fill(0.1))
      }),
      generateRAGResponse: vi.fn(async (query: string, context: string) =>
        `Response to "${query}" based on context`
      ),
      generateCompletion: vi.fn(async (messages: any, options?: any) => {
        if (options?.stream && options?.onChunk) {
          // Simulate streaming with immediate execution
          await Promise.resolve().then(() => {
            options.onChunk('Hello ')
            options.onChunk('world!')
          })
          return ''
        }
        return 'Completion response'
      }),
      generateCompletionWithUsage: vi.fn(async () => ({
        text: 'Completion with usage',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
      }))
    }))
  }
})

vi.mock('../src/lib/azure-search', () => {
  return {
    AzureSearchService: vi.fn().mockImplementation(() => ({
      testConnection: vi.fn(async () => ({ success: true })),
      indexDocuments: vi.fn(async () => ({ success: true })),
      vectorSearch: vi.fn(async () => [
        { documentId: 'doc1', content: 'Vector result', relevanceScore: 0.9, chunkId: 'c1', documentName: 'test.txt' }
      ]),
      keywordSearch: vi.fn(async () => [
        { documentId: 'doc2', content: 'Keyword result', relevanceScore: 0.8, chunkId: 'c2', documentName: 'test2.txt' }
      ]),
      semanticHybridSearch: vi.fn(async () => [
        { documentId: 'doc3', content: 'Hybrid result', relevanceScore: 0.95, chunkId: 'c3', documentName: 'test3.txt' }
      ]),
      deleteDocumentChunks: vi.fn(async () => ({ success: true })),
      rebuildIndex: vi.fn(async () => ({ success: true }))
    }))
  }
})

vi.mock('../src/lib/services/error-tracker', () => ({
  errorTracking: {
    record: vi.fn()
  }
}))

describe('AzureServiceManager', () => {
  let manager: AzureServiceManager
  const mockConfig: AzureConfig = {
    openai: {
      endpoint: 'https://test.openai.azure.com',
      apiKey: 'test-key',
      deploymentName: 'gpt-4',
      apiVersion: '2024-02-15-preview',
      embeddingDeploymentName: 'text-embedding-ada-002'
    },
    search: {
      endpoint: 'https://test.search.windows.net',
      apiKey: 'test-search-key',
      indexName: 'test-index',
      apiVersion: '2024-05-01-preview'
    }
  }

  beforeEach(() => {
    manager = new AzureServiceManager()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('initializes both OpenAI and Search services', async () => {
      const status = await manager.initialize(mockConfig)

      expect(status.openai).toBe('connected')
      expect(status.search).toBe('connected')
      expect(status.lastTested).toBeDefined()
      expect(manager.isConfigured()).toBe(true)
    })

    it('handles OpenAI connection failure', async () => {
      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockOpenAI = AzureOpenAIService as any
      mockOpenAI.mockImplementationOnce(() => ({
        testConnection: vi.fn(async () => ({ success: false, error: 'Connection failed' }))
      }))

      manager = new AzureServiceManager()
      const status = await manager.initialize(mockConfig)

      expect(status.openai).toBe('error')
      expect(status.errors?.openai).toBe('Connection failed')
    })

    it('handles Search connection failure', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockSearch = AzureSearchService as any
      mockSearch.mockImplementationOnce(() => ({
        testConnection: vi.fn(async () => ({ success: false, error: 'Search error' }))
      }))

      manager = new AzureServiceManager()
      const status = await manager.initialize(mockConfig)

      expect(status.search).toBe('error')
      expect(status.errors?.search).toBe('Search error')
    })

    it('handles exceptions during connection testing', async () => {
      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockOpenAI = AzureOpenAIService as any
      mockOpenAI.mockImplementationOnce(() => ({
        testConnection: vi.fn(async () => { throw new Error('Network error') })
      }))

      manager = new AzureServiceManager()
      const status = await manager.initialize(mockConfig)

      expect(status.openai).toBe('error')
      expect(status.errors?.openai).toContain('Network error')
    })

    it('applies Responses API configuration from config', async () => {
      const configWithResponses = {
        ...mockConfig,
        openai: {
          ...mockConfig.openai,
          useResponsesApi: true,
          responsesModel: 'gpt-4-turbo',
          responsesStore: true
        }
      }

      await manager.initialize(configWithResponses)

      expect(manager.isConfigured()).toBe(true)
    })

    it('applies Responses API configuration from environment variables', async () => {
      process.env.VITE_AZURE_USE_RESPONSES = 'true'
      process.env.VITE_AZURE_RESPONSES_MODEL = 'gpt-4'
      process.env.VITE_AZURE_RESPONSES_STORE = 'true'

      await manager.initialize(mockConfig)

      expect(manager.isConfigured()).toBe(true)

      delete process.env.VITE_AZURE_USE_RESPONSES
      delete process.env.VITE_AZURE_RESPONSES_MODEL
      delete process.env.VITE_AZURE_RESPONSES_STORE
    })
  })

  describe('isConfigured and hasOpenAI', () => {
    it('returns false when not initialized', () => {
      expect(manager.isConfigured()).toBe(false)
      expect(manager.hasOpenAI()).toBe(false)
    })

    it('returns true after initialization', async () => {
      await manager.initialize(mockConfig)

      expect(manager.isConfigured()).toBe(true)
      expect(manager.hasOpenAI()).toBe(true)
    })
  })

  describe('getSearchService and getNamespaceId', () => {
    it('returns null when not initialized', () => {
      expect(manager.getSearchService()).toBeNull()
      expect(manager.getNamespaceId()).toBeUndefined()
    })

    it('returns services after initialization', async () => {
      await manager.initialize(mockConfig)

      expect(manager.getSearchService()).not.toBeNull()
    })

    it('returns namespace from config', async () => {
      const configWithNamespace = {
        ...mockConfig,
        search: {
          ...mockConfig.search,
          namespace: 'test-namespace'
        }
      }

      await manager.initialize(configWithNamespace)

      expect(manager.getNamespaceId()).toBe('test-namespace')
    })
  })

  describe('tryGenerateQueryEmbedding', () => {
    it('generates embedding when configured', async () => {
      await manager.initialize(mockConfig)

      const embedding = await manager.tryGenerateQueryEmbedding('test query')

      expect(embedding).not.toBeNull()
      expect(embedding).toHaveLength(1536)
    })

    it('returns null when not configured', async () => {
      const embedding = await manager.tryGenerateQueryEmbedding('test query')

      expect(embedding).toBeNull()
    })

    it('returns null on error', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      mockInstance.generateEmbedding = vi.fn(async () => { throw new Error('Embedding failed') })

      const embedding = await manager.tryGenerateQueryEmbedding('test query')

      expect(embedding).toBeNull()
    })
  })

  describe('processDocumentWithAzure', () => {
    const createMockDocument = (): Document => ({
      id: 'doc-1',
      name: 'test.txt',
      content: 'Test content',
      uploadedAt: new Date().toISOString(),
      chunks: [
        {
          content: 'Chunk 1',
          embedding: [],
          chunkIndex: 0,
          id: 'chunk-1'
        },
        {
          content: 'Chunk 2',
          embedding: [],
          chunkIndex: 1,
          id: 'chunk-2'
        }
      ]
    })

    it('throws error when not configured', async () => {
      const doc = createMockDocument()

      await expect(manager.processDocumentWithAzure(doc)).rejects.toThrow(
        'Azure services not configured'
      )
    })

    it('generates embeddings and indexes document', async () => {
      await manager.initialize(mockConfig)
      const doc = createMockDocument()

      const result = await manager.processDocumentWithAzure(doc)

      expect(result.azureIndexed).toBe(true)
      expect(result.processingStatus).toBe('completed')
      expect(result.chunks[0].azureEmbedding).toBeDefined()
      expect(result.chunks[0].vectorId).toBeDefined()
    })

    it('calls progress callback during embedding generation', async () => {
      await manager.initialize(mockConfig)
      const doc = createMockDocument()
      const onProgress = vi.fn()

      await manager.processDocumentWithAzure(doc, onProgress)

      expect(onProgress).toHaveBeenCalled()
    })

    it('handles indexing failure', async () => {
      await manager.initialize(mockConfig)

      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      mockInstance.indexDocuments = vi.fn(async () => ({
        success: false,
        error: 'Indexing failed'
      }))

      const doc = createMockDocument()
      const result = await manager.processDocumentWithAzure(doc)

      expect(result.processingStatus).toBe('error')
      expect(result.errorMessage).toContain('Indexing failed')
    })

    it('handles embedding generation error', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      mockInstance.generateBatchEmbeddings = vi.fn(async () => {
        throw new Error('Embedding error')
      })

      const doc = createMockDocument()
      const result = await manager.processDocumentWithAzure(doc)

      expect(result.processingStatus).toBe('error')
      expect(result.errorMessage).toBeDefined()
    })
  })

  describe('searchWithAzure', () => {
    beforeEach(async () => {
      await manager.initialize(mockConfig)
    })

    it('throws error when not configured', async () => {
      const unconfiguredManager = new AzureServiceManager()

      await expect(unconfiguredManager.searchWithAzure('test')).rejects.toThrow(
        'Azure services not configured'
      )
    })

    it('performs hybrid search by default', async () => {
      // Use a longer query to avoid skipSemantic optimization
      const results = await manager.searchWithAzure('this is a longer test query')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Hybrid result')
    })

    it('performs keyword search when strategy is keyword', async () => {
      const results = await manager.searchWithAzure('test query', 'keyword')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Keyword result')
    })

    it('performs vector search when strategy is vector', async () => {
      const results = await manager.searchWithAzure('test query', 'vector')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Vector result')
    })

    it('falls back to vector search when keyword search returns no results', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      mockInstance.keywordSearch = vi.fn(async () => [])

      const results = await manager.searchWithAzure('test query', 'keyword')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Vector result')
    })

    it('falls back to keyword search when vector search returns no results', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      mockInstance.vectorSearch = vi.fn(async () => [])

      const results = await manager.searchWithAzure('test query', 'vector')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Keyword result')
    })

    it('skips semantic search for short queries', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      const semanticSpy = vi.spyOn(mockInstance, 'semanticHybridSearch')
      mockInstance.keywordSearch = vi.fn(async () => [
        { documentId: 'doc', content: 'Result', relevanceScore: 0.8, chunkId: 'c', documentName: 'test.txt' }
      ])

      await manager.searchWithAzure('hi', 'hybrid')

      expect(semanticSpy).not.toHaveBeenCalled()
    })

    it('handles search failures with multiple fallbacks', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value

      mockInstance.semanticHybridSearch = vi.fn(async () => { throw new Error('Semantic failed') })
      mockInstance.keywordSearch = vi.fn(async () => { throw new Error('Keyword failed') })
      mockInstance.vectorSearch = vi.fn(async () => [
        { documentId: 'doc', content: 'Fallback', relevanceScore: 0.7, chunkId: 'c', documentName: 'test.txt' }
      ])

      const results = await manager.searchWithAzure('test query', 'hybrid')

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Fallback')
    })

    it('returns empty results when all strategies fail', async () => {
      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value

      mockInstance.semanticHybridSearch = vi.fn(async () => { throw new Error('Failed') })
      mockInstance.keywordSearch = vi.fn(async () => { throw new Error('Failed') })
      mockInstance.vectorSearch = vi.fn(async () => { throw new Error('Failed') })

      const results = await manager.searchWithAzure('test query', 'hybrid')

      expect(results).toHaveLength(0)
    })
  })

  describe('generateResponseWithAzure', () => {
    it('throws error when OpenAI not configured', async () => {
      const sources = [
        { documentId: 'doc1', content: 'Content 1', relevanceScore: 0.9, chunkId: 'c1', documentName: 'test.txt' }
      ]

      await expect(manager.generateResponseWithAzure('query', sources)).rejects.toThrow(
        'Azure OpenAI service not configured'
      )
    })

    it('generates response from sources', async () => {
      await manager.initialize(mockConfig)

      const sources = [
        { documentId: 'doc1', content: 'Content 1', relevanceScore: 0.9, chunkId: 'c1', documentName: 'test.txt' },
        { documentId: 'doc2', content: 'Content 2', relevanceScore: 0.8, chunkId: 'c2', documentName: 'test2.txt' }
      ]

      const response = await manager.generateResponseWithAzure('test query', sources)

      expect(response).toContain('Response to')
      expect(response).toContain('test query')
    })

    it('formats sources with context markers', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      const ragSpy = vi.spyOn(mockInstance, 'generateRAGResponse')

      const sources = [
        { documentId: 'doc1', content: 'Content 1', relevanceScore: 0.9, chunkId: 'c1', documentName: 'test.txt' }
      ]

      await manager.generateResponseWithAzure('query', sources)

      expect(ragSpy).toHaveBeenCalledWith('query', expect.stringContaining('[1] Content 1'))
    })

    it('handles generation errors', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      mockInstance.generateRAGResponse = vi.fn(async () => {
        throw new Error('Generation failed')
      })

      const sources = [
        { documentId: 'doc1', content: 'Content', relevanceScore: 0.9, chunkId: 'c1', documentName: 'test.txt' }
      ]

      await expect(manager.generateResponseWithAzure('query', sources)).rejects.toThrow(
        'Generation failed'
      )
    })
  })

  describe('deleteDocumentFromAzure', () => {
    it('returns error when not configured', async () => {
      const result = await manager.deleteDocumentFromAzure('doc-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Azure services not configured')
    })

    it('deletes document successfully', async () => {
      await manager.initialize(mockConfig)

      const result = await manager.deleteDocumentFromAzure('doc-1')

      expect(result.success).toBe(true)
    })

    it('handles deletion errors', async () => {
      await manager.initialize(mockConfig)

      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      mockInstance.deleteDocumentChunks = vi.fn(async () => {
        throw new Error('Delete failed')
      })

      const result = await manager.deleteDocumentFromAzure('doc-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Delete failed')
    })
  })

  describe('rebuildSearchIndex', () => {
    it('rebuilds index with current config', async () => {
      await manager.initialize(mockConfig)

      const result = await manager.rebuildSearchIndex()

      expect(result.success).toBe(true)
    })

    it('rebuilds index with new config', async () => {
      const result = await manager.rebuildSearchIndex(mockConfig, 3072)

      expect(result.success).toBe(true)
    })

    it('returns error when search not configured', async () => {
      const result = await manager.rebuildSearchIndex()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Azure Search service not configured')
    })

    it('handles rebuild errors', async () => {
      await manager.initialize(mockConfig)

      const { AzureSearchService } = await import('../src/lib/azure-search')
      const mockInstance = (AzureSearchService as any).mock.results[0].value
      mockInstance.rebuildIndex = vi.fn(async () => {
        throw new Error('Rebuild failed')
      })

      const result = await manager.rebuildSearchIndex()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rebuild failed')
    })
  })

  describe('getConnectionStatus', () => {
    it('returns null when not configured', () => {
      const status = manager.getConnectionStatus()

      expect(status).toBeNull()
    })

    it('returns connection status when configured', async () => {
      await manager.initialize(mockConfig)

      const status = manager.getConnectionStatus()

      expect(status).not.toBeNull()
      expect(status?.openai).toBe('connected')
      expect(status?.search).toBe('connected')
      expect(status?.lastTested).toBeDefined()
    })
  })

  describe('generateCompletion', () => {
    it('throws error when not configured', async () => {
      await expect(manager.generateCompletion('test')).rejects.toThrow(
        'Azure OpenAI service not configured'
      )
    })

    it('generates completion from string', async () => {
      await manager.initialize(mockConfig)

      const result = await manager.generateCompletion('test prompt')

      expect(result).toBe('Completion response')
    })

    it('generates completion from messages array', async () => {
      await manager.initialize(mockConfig)

      const messages = [
        { role: 'user', content: 'Hello' }
      ]

      const result = await manager.generateCompletion(messages)

      expect(result).toBe('Completion response')
    })

    it('passes options to service', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      const completionSpy = vi.spyOn(mockInstance, 'generateCompletion')

      await manager.generateCompletion('test', {
        maxTokens: 100,
        temperature: 0.7,
        responseFormat: 'json_object'
      })

      expect(completionSpy).toHaveBeenCalledWith('test', expect.objectContaining({
        maxTokens: 100,
        temperature: 0.7,
        responseFormat: 'json_object'
      }))
    })
  })

  describe('generateCompletionWithUsage', () => {
    it('throws error when not configured', async () => {
      await expect(manager.generateCompletionWithUsage('test')).rejects.toThrow(
        'Azure OpenAI service not configured'
      )
    })

    it('returns completion with usage when available', async () => {
      await manager.initialize(mockConfig)

      const result = await manager.generateCompletionWithUsage('test')

      expect(result.text).toBe('Completion with usage')
      expect(result.usage).toBeDefined()
      expect(result.usage?.totalTokens).toBe(30)
    })

    it('returns completion without usage when streaming', async () => {
      await manager.initialize(mockConfig)

      const result = await manager.generateCompletionWithUsage('test', {
        stream: true
      } as any)

      expect(result.text).toBeDefined()
      expect(result.usage).toBeUndefined()
    })

    it('falls back when usage method not available', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      delete mockInstance.generateCompletionWithUsage

      const result = await manager.generateCompletionWithUsage('test')

      expect(result.text).toBe('Completion response')
      expect(result.usage).toBeUndefined()
    })
  })

  describe('generateStream', () => {
    it('throws error when not configured', () => {
      expect(() => manager.generateStream('test')).toThrow(
        'Azure OpenAI service not configured'
      )
    })

    it('returns async iterable that streams chunks', async () => {
      await manager.initialize(mockConfig)

      const stream = manager.generateStream('test prompt')
      const chunks: string[] = []

      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.join('')).toBeTruthy()
    })

    it('handles streaming errors', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      mockInstance.generateCompletion = vi.fn(async () => {
        throw new Error('Stream error')
      })

      const stream = manager.generateStream('test')

      await expect(async () => {
        for await (const chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('Stream error')
    })

    it('passes options to streaming call', async () => {
      await manager.initialize(mockConfig)

      const { AzureOpenAIService } = await import('../src/lib/azure-openai')
      const mockInstance = (AzureOpenAIService as any).mock.results[0].value
      const completionSpy = vi.spyOn(mockInstance, 'generateCompletion')

      const stream = manager.generateStream('test', {
        maxTokens: 50,
        temperature: 0.5
      })

      // Start consuming stream
      const iterator = stream[Symbol.asyncIterator]()
      await iterator.next()

      expect(completionSpy).toHaveBeenCalledWith('test', expect.objectContaining({
        maxTokens: 50,
        temperature: 0.5,
        stream: true
      }))
    })
  })
})
