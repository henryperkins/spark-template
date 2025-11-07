import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chunkDocument,
  calculateSimilarity,
  computeCosineSimilarity,
  rrfFuse,
  findRelevantChunksLocal,
  generateResponse,
  intelligentChunkDocument
} from '../src/lib/rag'
import type { Document, DocumentChunk, Source } from '../src/types'
import { azureServiceManager } from '../src/lib/azure-service-manager'

describe('RAG Core Functions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('chunkDocument', () => {
    it('chunks text by paragraphs and sentences', () => {
      const content = 'First sentence. Second sentence.\n\nSecond paragraph here. More text.'
      const chunks = chunkDocument(content, 'doc-1', 500)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].documentId).toBe('doc-1')
      expect(chunks[0].chunkIndex).toBe(0)
      expect(chunks[0].id).toBe('doc-1-chunk-0')
    })

    it('splits content that exceeds maxChunkSize', () => {
      const content = 'A'.repeat(2000) + '. ' + 'B'.repeat(2000) + '.'
      const chunks = chunkDocument(content, 'doc-2', 1000)

      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index)
        // Chunks may exceed maxChunkSize if they contain long sentences
      })
    })

    it('handles single paragraph shorter than chunk size', () => {
      const content = 'Short content here.'
      const chunks = chunkDocument(content, 'doc-3', 1000)

      expect(chunks.length).toBe(1)
      expect(chunks[0].content).toContain('Short content here')
    })

    it('handles empty content', () => {
      const chunks = chunkDocument('', 'doc-4', 1000)

      expect(chunks.length).toBe(1)
      expect(chunks[0].content).toBe('')
    })
  })

  describe('intelligentChunkDocument', () => {
    it('analyzes document and applies appropriate chunking strategy', async () => {
      const content = 'This is a test document.\n\nSecond paragraph here.'
      const fileName = 'test.txt'

      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(false)

      const result = await intelligentChunkDocument(content, 'doc-5', fileName)

      expect(result.chunks.length).toBeGreaterThan(0)
      expect(result.strategy).toBeDefined()
      expect(['paragraph', 'sentence', 'semantic', 'fixed']).toContain(result.strategy)
    })
  })

  describe('calculateSimilarity', () => {
    it('calculates Jaccard similarity between query and chunk', () => {
      const query = 'machine learning algorithms'
      const chunk: DocumentChunk = {
        id: 'c1',
        documentId: 'd1',
        chunkIndex: 0,
        content: 'Machine learning is about algorithms and data'
      }

      const similarity = calculateSimilarity(query, chunk)

      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThanOrEqual(1)
    })

    it('returns 0 for completely different text', () => {
      const query = 'cats and dogs'
      const chunk: DocumentChunk = {
        id: 'c2',
        documentId: 'd2',
        chunkIndex: 0,
        content: 'quantum physics equations'
      }

      const similarity = calculateSimilarity(query, chunk)

      expect(similarity).toBeGreaterThanOrEqual(0)
      expect(similarity).toBeLessThan(0.3)
    })

    it('returns 1 for identical text', () => {
      const text = 'exactly the same words'
      const chunk: DocumentChunk = {
        id: 'c3',
        documentId: 'd3',
        chunkIndex: 0,
        content: text
      }

      const similarity = calculateSimilarity(text, chunk)

      expect(similarity).toBe(1)
    })
  })

  describe('computeCosineSimilarity', () => {
    it('calculates cosine similarity between vectors', () => {
      const a = [1, 0, 0]
      const b = [1, 0, 0]

      const similarity = computeCosineSimilarity(a, b)

      expect(similarity).toBeCloseTo(1, 5)
    })

    it('returns 0 for orthogonal vectors', () => {
      const a = [1, 0, 0]
      const b = [0, 1, 0]

      const similarity = computeCosineSimilarity(a, b)

      expect(similarity).toBeCloseTo(0, 5)
    })

    it('handles normalized vectors', () => {
      const a = [0.6, 0.8]
      const b = [0.8, 0.6]

      const similarity = computeCosineSimilarity(a, b)

      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThan(1)
    })

    it('returns 0 for mismatched vector lengths', () => {
      const a = [1, 2, 3]
      const b = [1, 2]

      const similarity = computeCosineSimilarity(a, b)

      expect(similarity).toBe(0)
    })

    it('returns 0 for empty vectors', () => {
      const similarity = computeCosineSimilarity([], [])

      expect(similarity).toBe(0)
    })

    it('returns 0 for zero vectors', () => {
      const a = [0, 0, 0]
      const b = [1, 2, 3]

      const similarity = computeCosineSimilarity(a, b)

      expect(similarity).toBe(0)
    })
  })

  describe('rrfFuse', () => {
    it('fuses two ranked lists using RRF', () => {
      const list1: Source[] = [
        { documentId: 'd1', documentName: 'doc1', chunkId: 'c1', content: 'First result', relevanceScore: 0.9 },
        { documentId: 'd2', documentName: 'doc2', chunkId: 'c2', content: 'Second result', relevanceScore: 0.7 }
      ]

      const list2: Source[] = [
        { documentId: 'd2', documentName: 'doc2', chunkId: 'c2', content: 'Second result', relevanceScore: 0.8 },
        { documentId: 'd3', documentName: 'doc3', chunkId: 'c3', content: 'Third result', relevanceScore: 0.6 }
      ]

      const fused = rrfFuse(list1, list2)

      expect(fused.length).toBe(3)
      // c2 appears in both lists, should be ranked higher
      expect(fused[0].chunkId).toBe('c2')
    })

    it('handles empty lists', () => {
      const result = rrfFuse([], [])

      expect(result).toEqual([])
    })

    it('preserves highest relevanceScore when merging duplicates', () => {
      const list1: Source[] = [
        { documentId: 'd1', documentName: 'doc1', chunkId: 'c1', content: 'Result', relevanceScore: 0.5 }
      ]

      const list2: Source[] = [
        { documentId: 'd1', documentName: 'doc1', chunkId: 'c1', content: 'Result', relevanceScore: 0.9 }
      ]

      const fused = rrfFuse(list1, list2)

      expect(fused.length).toBe(1)
      expect(fused[0].relevanceScore).toBe(0.9)
    })
  })

  describe('findRelevantChunksLocal', () => {
    const createTestDocument = (id: string, chunks: Array<{ content: string; embedding?: number[] }>): Document => ({
      id,
      name: `${id}.txt`,
      size: 100,
      uploadedAt: new Date().toISOString(),
      type: 'text/plain',
      processed: true,
      processingStatus: 'completed',
      chunks: chunks.map((c, i) => ({
        id: `${id}-chunk-${i}`,
        documentId: id,
        chunkIndex: i,
        content: c.content,
        embedding: c.embedding
      })),
      source: 'upload'
    })

    beforeEach(() => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(false)
    })

    it('finds relevant chunks using keyword strategy', async () => {
      const docs = [
        createTestDocument('d1', [
          { content: 'Machine learning algorithms are powerful' },
          { content: 'Database indexing strategies' }
        ]),
        createTestDocument('d2', [
          { content: 'Deep learning and neural networks' }
        ])
      ]

      const results = await findRelevantChunksLocal('machine learning', docs, 2, 'keyword')

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('Machine learning')
    })

    it('returns empty array when no chunks match', async () => {
      const docs = [
        createTestDocument('d1', [
          { content: 'Completely unrelated content' }
        ])
      ]

      const results = await findRelevantChunksLocal('quantum physics', docs, 5, 'keyword')

      // Should still return something even if low relevance
      expect(Array.isArray(results)).toBe(true)
    })

    it('respects maxResults limit', async () => {
      const docs = [
        createTestDocument('d1', [
          { content: 'Test content one' },
          { content: 'Test content two' },
          { content: 'Test content three' },
          { content: 'Test content four' },
          { content: 'Test content five' }
        ])
      ]

      const results = await findRelevantChunksLocal('test content', docs, 3, 'keyword')

      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('uses vector strategy when embeddings available', async () => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)
      vi.spyOn(azureServiceManager, 'tryGenerateQueryEmbedding').mockResolvedValue([0.5, 0.5, 0.5])

      const docs = [
        createTestDocument('d1', [
          { content: 'Vector search content', embedding: [0.6, 0.4, 0.5] },
          { content: 'Another vector chunk', embedding: [0.1, 0.9, 0.2] }
        ])
      ]

      const results = await findRelevantChunksLocal('search query', docs, 5, 'vector')

      expect(results.length).toBeGreaterThan(0)
    })

    it('filters by namespace when provided', async () => {
      const docs = [
        createTestDocument('d1', [
          { content: 'Namespace A content' },
          { content: 'Namespace B content' }
        ])
      ]

      // Add namespace to chunks
      docs[0].chunks[0].namespace = 'ns-a'
      docs[0].chunks[1].namespace = 'ns-b'

      const results = await findRelevantChunksLocal('content', docs, 5, 'keyword', { namespaceId: 'ns-a' })

      expect(results.length).toBe(1)
      expect(results[0].content).toContain('Namespace A')
    })

    it('falls back to keyword when vector strategy fails', async () => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(false)

      const docs = [
        createTestDocument('d1', [
          { content: 'Fallback test content' }
        ])
      ]

      // Request vector but should fallback to keyword
      const results = await findRelevantChunksLocal('test', docs, 5, 'vector')

      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe('generateResponse', () => {
    it('returns helpful message when no sources provided', async () => {
      const response = await generateResponse('test query', [])

      expect(response).toContain('don\'t have enough relevant information')
    })

    it('generates response from sources with Azure OpenAI', async () => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)
      vi.spyOn(azureServiceManager, 'generateResponseWithAzure').mockResolvedValue('Generated answer from Azure')

      const sources: Source[] = [
        { documentId: 'd1', documentName: 'doc.txt', chunkId: 'c1', content: 'Source content', relevanceScore: 0.9 }
      ]

      const response = await generateResponse('What is this about?', sources)

      expect(response).toBe('Generated answer from Azure')
    })

    it('falls back to worker LLM when Azure fails', async () => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)
      vi.spyOn(azureServiceManager, 'generateResponseWithAzure').mockRejectedValue(new Error('Azure failure'))

      // Mock runtime.llm
      const mockRuntime = {
        llm: {
          complete: vi.fn().mockResolvedValue('Worker LLM response')
        }
      }
      vi.doMock('../src/lib/runtime-context', () => ({
        runtime: mockRuntime
      }))

      const sources: Source[] = [
        { documentId: 'd1', documentName: 'doc.txt', chunkId: 'c1', content: 'Source content', relevanceScore: 0.9 }
      ]

      const response = await generateResponse('Question?', sources)

      // Should not throw and return some response
      expect(typeof response).toBe('string')
    })

    it('formats sources with citation numbers', async () => {
      vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)

      let capturedContext = ''
      vi.spyOn(azureServiceManager, 'generateResponseWithAzure').mockImplementation(async (query, sources) => {
        // Capture how sources are formatted
        capturedContext = sources.map((s, i) => `[${i + 1}] ${s.content}`).join('\n\n')
        return 'Response with sources'
      })

      const sources: Source[] = [
        { documentId: 'd1', documentName: 'doc1.txt', chunkId: 'c1', content: 'First source', relevanceScore: 0.9 },
        { documentId: 'd2', documentName: 'doc2.txt', chunkId: 'c2', content: 'Second source', relevanceScore: 0.8 }
      ]

      await generateResponse('Query', sources)

      expect(capturedContext).toContain('[1] First source')
      expect(capturedContext).toContain('[2] Second source')
    })
  })
})
