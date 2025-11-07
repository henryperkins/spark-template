import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmbeddingManager } from '../src/lib/embedding-manager'
import type { Document } from '../src/types'
import type { CloudflareKVAdapter } from '../src/lib/cloudflare-kv'

describe('EmbeddingManager', () => {
  let manager: EmbeddingManager
  let mockKV: CloudflareKVAdapter

  const createMockDocument = (id: string, name: string, chunks: string[]): Document => ({
    id,
    name,
    content: chunks.join(' '),
    uploadedAt: new Date().toISOString(),
    chunks: chunks.map((content, index) => ({
      content,
      embedding: new Array(1536).fill(0.1),
      chunkIndex: index
    }))
  })

  beforeEach(() => {
    // Create a mock KV adapter
    const kvStore = new Map<string, any>()
    mockKV = {
      get: vi.fn(async (key: string) => kvStore.get(key) || null),
      set: vi.fn(async (key: string, value: any) => {
        kvStore.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        kvStore.delete(key)
      }),
      keys: vi.fn(async () => Array.from(kvStore.keys()))
    }

    manager = new EmbeddingManager(mockKV)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('calculateChecksum', () => {
    it('generates consistent SHA-256 checksums for same content', async () => {
      const content = 'test content'

      const checksum1 = await manager.calculateChecksum(content)
      const checksum2 = await manager.calculateChecksum(content)

      expect(checksum1).toBe(checksum2)
      expect(checksum1).toHaveLength(64) // SHA-256 produces 64 hex characters
    })

    it('generates different checksums for different content', async () => {
      const checksum1 = await manager.calculateChecksum('content one')
      const checksum2 = await manager.calculateChecksum('content two')

      expect(checksum1).not.toBe(checksum2)
    })

    it('handles empty strings', async () => {
      const checksum = await manager.calculateChecksum('')

      expect(checksum).toHaveLength(64)
      expect(checksum).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })

    it('handles unicode content', async () => {
      const checksum = await manager.calculateChecksum('Hello 世界 🌍')

      expect(checksum).toHaveLength(64)
      expect(checksum).toBeDefined()
    })
  })

  describe('getMetadata and setMetadata', () => {
    it('stores and retrieves metadata', async () => {
      const metadata = {
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'abc123',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 5,
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low' as const
      }

      await manager.setMetadata(metadata)
      const retrieved = await manager.getMetadata('doc-1')

      expect(retrieved).toEqual(metadata)
    })

    it('returns null for non-existent metadata', async () => {
      const result = await manager.getMetadata('non-existent')

      expect(result).toBeNull()
    })

    it('overwrites existing metadata', async () => {
      const metadata1 = {
        version: 'v1',
        lastRefreshed: new Date().toISOString(),
        checksum: 'old',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 3,
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low' as const
      }

      const metadata2 = {
        ...metadata1,
        version: 'v2',
        checksum: 'new',
        chunkCount: 5
      }

      await manager.setMetadata(metadata1)
      await manager.setMetadata(metadata2)

      const retrieved = await manager.getMetadata('doc-1')

      expect(retrieved?.version).toBe('v2')
      expect(retrieved?.checksum).toBe('new')
      expect(retrieved?.chunkCount).toBe(5)
    })
  })

  describe('needsRefresh', () => {
    it('requires refresh when no metadata exists', async () => {
      const doc = createMockDocument('doc-1', 'test.txt', ['chunk 1', 'chunk 2'])

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('No metadata found')
    })

    it('requires refresh when version changes', async () => {
      const doc = createMockDocument('doc-1', 'test.txt', ['chunk 1'])
      const checksum = await manager.calculateChecksum('chunk 1')

      await manager.setMetadata({
        version: 'v2024.01', // Old version
        lastRefreshed: new Date().toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('Version mismatch')
    })

    it('requires refresh when content changes (checksum mismatch)', async () => {
      const doc = createMockDocument('doc-1', 'test.txt', ['new content'])

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'old-checksum',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('checksum mismatch')
    })

    it('requires refresh when chunk count changes', async () => {
      const doc = createMockDocument('doc-1', 'test.txt', ['chunk 1', 'chunk 2', 'chunk 3'])
      const checksum = await manager.calculateChecksum('chunk 1|chunk 2|chunk 3')

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 2, // Different from actual count
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('Chunk count changed')
    })

    it('requires refresh for high volatility documents after 1 day', async () => {
      const doc = createMockDocument('doc-1', 'news-update.txt', ['chunk 1'])
      const checksum = await manager.calculateChecksum('chunk 1')

      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: twoDaysAgo.toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'news-update.txt',
        volatility: 'high'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('Exceeded refresh threshold')
    })

    it('requires refresh for medium volatility documents after 7 days', async () => {
      const doc = createMockDocument('doc-1', 'report.txt', ['chunk 1'])
      const checksum = await manager.calculateChecksum('chunk 1')

      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: tenDaysAgo.toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'report.txt',
        volatility: 'medium'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('Exceeded refresh threshold')
    })

    it('requires refresh for low volatility documents after 30 days', async () => {
      const doc = createMockDocument('doc-1', 'manual.txt', ['chunk 1'])
      const checksum = await manager.calculateChecksum('chunk 1')

      const fortyDaysAgo = new Date()
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40)

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: fortyDaysAgo.toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'manual.txt',
        volatility: 'low'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(true)
      expect(result.reason).toContain('Exceeded refresh threshold')
    })

    it('does not require refresh when up to date', async () => {
      const doc = createMockDocument('doc-1', 'test.txt', ['chunk 1'])
      const checksum = await manager.calculateChecksum('chunk 1')

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'test.txt',
        volatility: 'low'
      })

      const result = await manager.needsRefresh(doc)

      expect(result.needed).toBe(false)
      expect(result.reason).toBe('Up to date')
    })
  })

  describe('performIncrementalRefresh', () => {
    it('refreshes only documents that need updating', async () => {
      const doc1 = createMockDocument('doc-1', 'old.txt', ['content 1'])
      const doc2 = createMockDocument('doc-2', 'current.txt', ['content 2'])

      // doc1 has old metadata
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 50)
      await manager.setMetadata({
        version: 'v2024.01', // Old version
        lastRefreshed: oldDate.toISOString(),
        checksum: 'old',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'old.txt',
        volatility: 'low'
      })

      // doc2 has current metadata
      const checksum2 = await manager.calculateChecksum('content 2')
      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: checksum2,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-2',
        documentName: 'current.txt',
        volatility: 'low'
      })

      const result = await manager.performIncrementalRefresh([doc1, doc2])

      expect(result.refreshedCount).toBe(1)
      expect(result.skippedCount).toBe(1)
      expect(result.totalProcessed).toBe(2)
      expect(result.changes).toHaveLength(2)
      expect(result.changes[0].action).toBe('refreshed')
      expect(result.changes[1].action).toBe('skipped')
    })

    it('calls progress callback during refresh', async () => {
      const docs = [
        createMockDocument('doc-1', 'test1.txt', ['content 1']),
        createMockDocument('doc-2', 'test2.txt', ['content 2'])
      ]

      const progressCalls: any[] = []
      const onProgress = vi.fn((progress) => {
        progressCalls.push(progress)
      })

      await manager.performIncrementalRefresh(docs, onProgress)

      expect(onProgress).toHaveBeenCalledTimes(2)
      expect(progressCalls[0]).toEqual({ current: 1, total: 2, documentName: 'test1.txt' })
      expect(progressCalls[1]).toEqual({ current: 2, total: 2, documentName: 'test2.txt' })
    })

    it('returns duration in milliseconds', async () => {
      const docs = [createMockDocument('doc-1', 'test.txt', ['content'])]

      const result = await manager.performIncrementalRefresh(docs)

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(typeof result.duration).toBe('number')
    })

    it('handles empty document list', async () => {
      const result = await manager.performIncrementalRefresh([])

      expect(result.refreshedCount).toBe(0)
      expect(result.skippedCount).toBe(0)
      expect(result.totalProcessed).toBe(0)
      expect(result.changes).toHaveLength(0)
    })
  })

  describe('performFullRefresh', () => {
    it('refreshes all documents regardless of state', async () => {
      const docs = [
        createMockDocument('doc-1', 'test1.txt', ['content 1']),
        createMockDocument('doc-2', 'test2.txt', ['content 2']),
        createMockDocument('doc-3', 'test3.txt', ['content 3'])
      ]

      // Set up-to-date metadata for one document
      const checksum = await manager.calculateChecksum('content 1')
      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum,
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'test1.txt',
        volatility: 'low'
      })

      const result = await manager.performFullRefresh(docs)

      expect(result.refreshedCount).toBe(3)
      expect(result.skippedCount).toBe(0)
      expect(result.totalProcessed).toBe(3)
      expect(result.changes.every(c => c.action === 'refreshed')).toBe(true)
      expect(result.changes.every(c => c.reason === 'Full refresh scheduled')).toBe(true)
    })

    it('calls progress callback during refresh', async () => {
      const docs = [
        createMockDocument('doc-1', 'file1.txt', ['content']),
        createMockDocument('doc-2', 'file2.txt', ['content'])
      ]

      const onProgress = vi.fn()

      await manager.performFullRefresh(docs, onProgress)

      expect(onProgress).toHaveBeenCalledTimes(2)
    })

    it('updates metadata for all documents', async () => {
      const docs = [
        createMockDocument('doc-1', 'test.txt', ['content'])
      ]

      await manager.performFullRefresh(docs)

      const metadata = await manager.getMetadata('doc-1')

      expect(metadata).not.toBeNull()
      expect(metadata?.version).toBe('v2025.01')
      expect(metadata?.documentId).toBe('doc-1')
    })
  })

  describe('inferVolatility', () => {
    it('identifies high volatility documents', async () => {
      const newsDoc = createMockDocument('1', 'daily-news.txt', ['content'])
      const updateDoc = createMockDocument('2', 'system-update.md', ['content'])
      const changelogDoc = createMockDocument('3', 'CHANGELOG.md', ['content'])

      await manager.performFullRefresh([newsDoc, updateDoc, changelogDoc])

      const newsMetadata = await manager.getMetadata('1')
      const updateMetadata = await manager.getMetadata('2')
      const changelogMetadata = await manager.getMetadata('3')

      expect(newsMetadata?.volatility).toBe('high')
      expect(updateMetadata?.volatility).toBe('high')
      expect(changelogMetadata?.volatility).toBe('high')
    })

    it('identifies medium volatility documents', async () => {
      const reportDoc = createMockDocument('1', 'monthly-report.pdf', ['content'])
      const analysisDoc = createMockDocument('2', 'data-analysis.txt', ['content'])
      const summaryDoc = createMockDocument('3', 'summary.md', ['content'])

      await manager.performFullRefresh([reportDoc, analysisDoc, summaryDoc])

      const reportMetadata = await manager.getMetadata('1')
      const analysisMetadata = await manager.getMetadata('2')
      const summaryMetadata = await manager.getMetadata('3')

      expect(reportMetadata?.volatility).toBe('medium')
      expect(analysisMetadata?.volatility).toBe('medium')
      expect(summaryMetadata?.volatility).toBe('medium')
    })

    it('defaults to low volatility', async () => {
      const manualDoc = createMockDocument('1', 'user-manual.pdf', ['content'])
      const guideDoc = createMockDocument('2', 'installation-guide.txt', ['content'])

      await manager.performFullRefresh([manualDoc, guideDoc])

      const manualMetadata = await manager.getMetadata('1')
      const guideMetadata = await manager.getMetadata('2')

      expect(manualMetadata?.volatility).toBe('low')
      expect(guideMetadata?.volatility).toBe('low')
    })
  })

  describe('getVersionedNamespace', () => {
    it('returns namespace with current version', async () => {
      const namespace = await manager.getVersionedNamespace()

      expect(namespace).toBe('embeddings:v2025.01')
    })
  })

  describe('listAllVersions', () => {
    it('returns all unique versions from metadata', async () => {
      await manager.setMetadata({
        version: 'v2024.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'abc',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'test1.txt',
        volatility: 'low'
      })

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'def',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-2',
        documentName: 'test2.txt',
        volatility: 'low'
      })

      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'ghi',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-3',
        documentName: 'test3.txt',
        volatility: 'low'
      })

      const versions = await manager.listAllVersions()

      expect(versions).toHaveLength(2)
      expect(versions).toContain('v2024.01')
      expect(versions).toContain('v2025.01')
      expect(versions).toEqual(['v2024.01', 'v2025.01']) // Sorted
    })

    it('returns empty array when no metadata exists', async () => {
      const versions = await manager.listAllVersions()

      expect(versions).toEqual([])
    })
  })

  describe('getRefreshMetrics', () => {
    it('calculates comprehensive refresh metrics', async () => {
      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

      // High volatility doc needing refresh (> 1 day)
      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: twoDaysAgo.toISOString(),
        checksum: 'abc',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-1',
        documentName: 'news.txt',
        volatility: 'high'
      })

      // Medium volatility doc needing refresh (> 7 days)
      await manager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: tenDaysAgo.toISOString(),
        checksum: 'def',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-2',
        documentName: 'report.txt',
        volatility: 'medium'
      })

      // Low volatility doc not needing refresh
      await manager.setMetadata({
        version: 'v2024.01',
        lastRefreshed: new Date().toISOString(),
        checksum: 'ghi',
        modelVersion: 'text-embedding-ada-002',
        chunkCount: 1,
        documentId: 'doc-3',
        documentName: 'manual.txt',
        volatility: 'low'
      })

      const metrics = await manager.getRefreshMetrics()

      expect(metrics.totalDocuments).toBe(3)
      expect(metrics.byVersion['v2025.01']).toBe(2)
      expect(metrics.byVersion['v2024.01']).toBe(1)
      expect(metrics.byVolatility.high).toBe(1)
      expect(metrics.byVolatility.medium).toBe(1)
      expect(metrics.byVolatility.low).toBe(1)
      expect(metrics.needingRefresh).toBe(2) // High and medium volatility docs
      expect(metrics.averageDaysSinceRefresh).toBeGreaterThan(0)
    })

    it('returns zero metrics when no documents exist', async () => {
      const metrics = await manager.getRefreshMetrics()

      expect(metrics.totalDocuments).toBe(0)
      expect(metrics.byVersion).toEqual({})
      expect(metrics.byVolatility).toEqual({})
      expect(metrics.needingRefresh).toBe(0)
      expect(metrics.averageDaysSinceRefresh).toBe(0)
    })
  })

  describe('Constructor', () => {
    it('accepts null KV adapter', () => {
      const managerWithNull = new EmbeddingManager(null)

      expect(managerWithNull).toBeDefined()
    })

    it('uses provided KV adapter', async () => {
      const customKV = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        keys: vi.fn(async () => [])
      }

      const managerWithCustom = new EmbeddingManager(customKV)
      await managerWithCustom.getMetadata('test')

      expect(customKV.get).toHaveBeenCalled()
    })
  })
})
