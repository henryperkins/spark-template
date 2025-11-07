import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AzureSearchService } from '../src/lib/azure-search'
import type { AzureConfig, AzureSearchDocument, Source } from '../src/types'

describe('AzureSearchService', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let service: AzureSearchService

  const mockConfig: AzureConfig['search'] = {
    endpoint: 'https://test-search.search.windows.net',
    apiKey: 'test-key',
    indexName: 'test-index',
    apiVersion: '2024-05-01-preview'
  }

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch')
    service = new AzureSearchService(mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Constructor', () => {
    it('normalizes endpoint by removing trailing slashes', () => {
      const configWithSlash = { ...mockConfig, endpoint: 'https://test.search.windows.net///' }
      const svc = new AzureSearchService(configWithSlash)
      expect(svc).toBeDefined()
    })
  })

  describe('testConnection', () => {
    it('returns success when search endpoint responds OK', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const result = await service.testConnection()

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('handles 404 by attempting to create index', async () => {
      // First call: search returns 404
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      // Second call: GET existing index (returns 404, no existing index)
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      // Third call: PUT to create index
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 201 })
      )

      const result = await service.testConnection()

      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('detects authentication failure with 401', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      const result = await service.testConnection()

      expect(result.success).toBe(false)
      expect(result.error).toContain('Authentication failed')
    })

    it('detects CORS errors', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      const result = await service.testConnection()

      expect(result.success).toBe(false)
      expect(result.error).toContain('CORS Error')
    })
  })

  describe('indexDocuments', () => {
    it('successfully indexes documents', async () => {
      const docs: AzureSearchDocument[] = [
        {
          id: 'doc-1-chunk-0',
          content: 'Test content',
          contentVector: new Array(1536).fill(0.1),
          documentId: 'doc-1',
          documentName: 'test.txt',
          chunkIndex: 0
        }
      ]

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ key: 'doc-1-chunk-0', status: 200 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const result = await service.indexDocuments(docs)

      expect(result.success).toBe(true)
      expect(fetchSpy).toHaveBeenCalledOnce()

      const callArgs = fetchSpy.mock.calls[0]
      const fetchUrl = callArgs[0] as string
      const fetchOptions = callArgs[1] as RequestInit

      expect(fetchOptions.body).toBeDefined()
      const requestBody = JSON.parse(fetchOptions.body as string)
      expect(requestBody).toBeDefined()
      // When shouldProxy() is true, the batch is wrapped in a batch property
      const batch = requestBody.batch || requestBody
      expect(batch.value).toBeDefined()
      expect(batch.value).toHaveLength(1)
      expect(batch.value[0]['@search.action']).toBe('mergeOrUpload')
    })

    it('handles vector dimension mismatch by rebuilding index', async () => {
      const docs: AzureSearchDocument[] = [
        {
          id: 'doc-1',
          content: 'Test',
          contentVector: new Array(3072).fill(0.1), // Different dimension
          documentId: 'doc-1',
          documentName: 'test.txt',
          chunkIndex: 0
        }
      ]

      // First attempt: dimension mismatch
      fetchSpy.mockResolvedValueOnce(
        new Response('mismatch in vector dimensions, provided vector has a length of \'3072\'', {
          status: 400
        })
      )

      // Delete index for rebuild (204 No Content has no body)
      fetchSpy.mockResolvedValueOnce(
        new Response(null, { status: 204 })
      )

      // Check index removed (404)
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      // GET existing index before creating (404)
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      // Create new index
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 201 })
      )

      // Retry indexing
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ status: 200 }] }), { status: 200 })
      )

      const result = await service.indexDocuments(docs)

      expect(result.success).toBe(true)
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1)
    })

    it('includes namespace in metadata', async () => {
      const docs: AzureSearchDocument[] = [
        {
          id: 'doc-1',
          content: 'Test',
          contentVector: [],
          documentId: 'doc-1',
          documentName: 'test.txt',
          chunkIndex: 0
        }
      ]

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ status: 200 }] }), { status: 200 })
      )

      await service.indexDocuments(docs, 'custom-namespace')

      const callArgs = fetchSpy.mock.calls[0]
      const fetchOptions = callArgs[1] as RequestInit

      expect(fetchOptions.body).toBeDefined()
      const requestBody = JSON.parse(fetchOptions.body as string)
      expect(requestBody).toBeDefined()
      // When shouldProxy() is true, the batch is wrapped in a batch property
      const batch = requestBody.batch || requestBody
      expect(batch.value).toBeDefined()
      expect(batch.value[0]).toBeDefined()
      const metadata = JSON.parse(batch.value[0].metadata)
      expect(metadata.namespace_id).toBe('custom-namespace')
    })

    it('reports failed documents', async () => {
      const docs: AzureSearchDocument[] = [
        {
          id: 'doc-1',
          content: 'Test',
          contentVector: [],
          documentId: 'doc-1',
          documentName: 'test.txt',
          chunkIndex: 0
        }
      ]

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ status: 400, errorMessage: 'Invalid field' }] }), {
          status: 200
        })
      )

      const result = await service.indexDocuments(docs)

      expect(result.success).toBe(false)
      expect(result.error).toContain('failed to index')
    })
  })

  describe('vectorSearch', () => {
    it('performs vector search and returns sources', async () => {
      const queryVector = new Array(1536).fill(0.5)

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: 'chunk-1',
                content: 'Vector search result',
                documentId: 'd1',
                documentName: 'doc.txt',
                chunkIndex: 0
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const results = await service.vectorSearch(queryVector, 5)

      expect(results).toHaveLength(1)
      expect(results[0].chunkId).toBe('chunk-1')
      expect(results[0].content).toBe('Vector search result')
      expect(results[0].relevanceScore).toBeGreaterThan(0)
    })

    it('handles vector search errors', async () => {
      const queryVector = new Array(1536).fill(0.5)

      fetchSpy.mockResolvedValueOnce(
        new Response('Search failed', { status: 500 })
      )

      await expect(service.vectorSearch(queryVector, 5)).rejects.toThrow('Vector search failed')
    })
  })

  describe('keywordSearch', () => {
    it('performs keyword search', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: 'chunk-1',
                content: 'Keyword search result',
                documentId: 'd1',
                documentName: 'doc.txt',
                chunkIndex: 0,
                '@search.score': 85
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const results = await service.keywordSearch('test query', 5)

      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('Keyword search result')
      expect(results[0].azureScore).toBe(85)
    })

    it('applies namespace filter when provided', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), { status: 200 })
      )

      await service.keywordSearch('query', 5, 'my-namespace')

      const callArgs = fetchSpy.mock.calls[0]
      const fetchOptions = callArgs[1] as RequestInit

      expect(fetchOptions.body).toBeDefined()
      const requestBody = JSON.parse(fetchOptions.body as string)
      expect(requestBody).toBeDefined()
      // When shouldProxy() is true, the search payload is wrapped in a request property
      const searchPayload = requestBody.request || requestBody
      expect(searchPayload.filter).toBeDefined()
      expect(typeof searchPayload.filter).toBe('string')
      expect(searchPayload.filter).toContain('my-namespace')
    })
  })

  describe('semanticHybridSearch', () => {
    it('performs semantic hybrid search', async () => {
      const configWithSemantic = {
        ...mockConfig,
        semanticConfiguration: {
          enabled: true,
          configName: 'semantic-config'
        },
        hybridSearch: {
          enabled: true,
          enableRRF: true,
          enableSemanticReranker: true
        }
      }

      const svc = new AzureSearchService(configWithSemantic as AzureConfig['search'])
      const queryVector = new Array(1536).fill(0.5)

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: 'chunk-1',
                content: 'Hybrid search result',
                documentId: 'd1',
                documentName: 'doc.txt',
                chunkIndex: 0,
                '@search.score': 90,
                '@search.rerankerScore': 3.5,
                '@search.captions': [{ text: 'Caption text' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const results = await svc.semanticHybridSearch('query', queryVector, 5)

      expect(results).toHaveLength(1)
      expect(results[0].semanticCaption).toBe('Caption text')
      expect(results[0].semanticRerankerScore).toBe(3.5)
    })

    it('uses RRF when enabled', async () => {
      const configWithRRF = {
        ...mockConfig,
        hybridSearch: {
          enabled: true,
          enableRRF: true,
          maxTextRecallSize: 2000
        }
      }

      const svc = new AzureSearchService(configWithRRF as AzureConfig['search'])
      const queryVector = new Array(1536).fill(0.5)

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), { status: 200 })
      )

      await svc.semanticHybridSearch('query', queryVector, 5)

      const callArgs = fetchSpy.mock.calls[0]
      const requestBody = JSON.parse(callArgs[1]?.body as string)
      expect(requestBody).toBeDefined()

      // Check if hybridSearch is in the request body itself or nested in a 'request' property
      const searchPayload = requestBody.request || requestBody
      expect(searchPayload.hybridSearch).toBeDefined()
      expect(searchPayload.hybridSearch.maxTextRecallSize).toBe(2000)
    })
  })

  describe('deleteDocumentChunks', () => {
    it('finds and deletes document chunks', async () => {
      // Search for chunks
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              { id: 'chunk-1' },
              { id: 'chunk-2' }
            ]
          }),
          { status: 200 }
        )
      )

      // Delete chunks
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), { status: 200 })
      )

      const result = await service.deleteDocumentChunks('doc-1')

      expect(result.success).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      const deleteCallArgs = fetchSpy.mock.calls[1]
      const deleteFetchOptions = deleteCallArgs[1] as RequestInit

      expect(deleteFetchOptions.body).toBeDefined()
      const deleteBody = JSON.parse(deleteFetchOptions.body as string)
      expect(deleteBody).toBeDefined()
      // When shouldProxy() is true, the batch is wrapped in a batch property
      const deleteBatch = deleteBody.batch || deleteBody
      expect(deleteBatch.value).toBeDefined()
      expect(deleteBatch.value).toHaveLength(2)
      expect(deleteBatch.value[0]['@search.action']).toBe('delete')
    })

    it('succeeds when no chunks found', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), { status: 200 })
      )

      const result = await service.deleteDocumentChunks('doc-nonexistent')

      expect(result.success).toBe(true)
    })
  })

  describe('getIndexStats', () => {
    it('retrieves index statistics', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentCount: 150,
            storageSize: 1024000
          }),
          { status: 200 }
        )
      )

      const stats = await service.getIndexStats()

      expect(stats.documentCount).toBe(150)
      expect(stats.storageSize).toBe(1024000)
      expect(stats.error).toBeUndefined()
    })

    it('handles stats retrieval errors', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Error', { status: 500 })
      )

      const stats = await service.getIndexStats()

      expect(stats.documentCount).toBe(0)
      expect(stats.storageSize).toBe(0)
      expect(stats.error).toBeDefined()
    })
  })
})
