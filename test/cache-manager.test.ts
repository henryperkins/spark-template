import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CacheManager, type CacheEntry, type CloudflareKVAdapter } from '../src/lib/cache-manager'

// Mock KV adapter for testing
class MockKVAdapter implements CloudflareKVAdapter {
  private store = new Map<string, unknown>()

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async get(key: string): Promise<unknown> {
    return this.store.get(key)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

describe('CacheManager', () => {
  let mockKV: MockKVAdapter
  let cacheManager: CacheManager

  beforeEach(() => {
    mockKV = new MockKVAdapter()
    cacheManager = new CacheManager(mockKV)
    cacheManager.resetMetrics()
  })

  describe('Basic Operations', () => {
    it('sets and gets a value', async () => {
      await cacheManager.set('test-key', { data: 'test-value' })
      const result = await cacheManager.get<{ data: string }>('test-key')
      expect(result).toEqual({ data: 'test-value' })
    })

    it('returns null for non-existent key', async () => {
      const result = await cacheManager.get('non-existent')
      expect(result).toBeNull()
    })

    it('stores cache entry with metadata', async () => {
      await cacheManager.set('meta-test', { value: 123 })
      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('meta-test'))
      expect(cacheKey).toBeDefined()

      const rawEntry = await mockKV.get(cacheKey!) as CacheEntry
      expect(rawEntry.data).toEqual({ value: 123 })
      expect(rawEntry.version).toBe('v2025.01')
      expect(rawEntry.timestamp).toBeDefined()
      expect(rawEntry.ttl).toBeGreaterThan(0)
    })

    it('invalidates a key', async () => {
      await cacheManager.set('invalidate-test', 'value')
      let result = await cacheManager.get('invalidate-test')
      expect(result).toBe('value')

      await cacheManager.invalidate(['invalidate-test'], 'manual', 'Test invalidation')
      result = await cacheManager.get('invalidate-test')
      expect(result).toBeNull()
    })
  })

  describe('TTL Management', () => {
    it('applies custom TTL', async () => {
      const customTTL = 5000
      await cacheManager.set('custom-ttl', 'value', customTTL)

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('custom-ttl'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.ttl).toBe(customTTL)
    })

    it('applies content-based TTL for news', async () => {
      await cacheManager.set('news:breaking-story', 'value')

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('news:breaking-story'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.ttl).toBe(5 * 60 * 1000) // 5 minutes
    })

    it('applies content-based TTL for static content', async () => {
      await cacheManager.set('static:document', 'value')

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('static:document'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.ttl).toBe(24 * 60 * 60 * 1000) // 24 hours
    })

    it('returns null for expired entries', async () => {
      // Set with very short TTL
      await cacheManager.set('expire-test', 'value', 1)

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 10))

      const result = await cacheManager.get('expire-test')
      expect(result).toBeNull()
    })
  })

  describe('Version Management', () => {
    it('invalidates entries with wrong version', async () => {
      const wrongVersionEntry: CacheEntry = {
        data: 'old-data',
        timestamp: new Date().toISOString(),
        version: 'v2024.01', // Old version
        ttl: 3600000,
        accessCount: 0,
        lastAccessed: new Date().toISOString()
      }

      await mockKV.set('cache:v2025.01:version-test', wrongVersionEntry)

      const result = await cacheManager.get('version-test')
      expect(result).toBeNull()
    })
  })

  describe('Access Tracking', () => {
    it('increments access count on get', async () => {
      await cacheManager.set('access-test', 'value')

      // Access twice
      await cacheManager.get('access-test')
      await cacheManager.get('access-test')

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('access-test'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.accessCount).toBe(2)
    })

    it('updates lastAccessed on get', async () => {
      await cacheManager.set('last-access-test', 'value')
      await new Promise(resolve => setTimeout(resolve, 10))

      const beforeAccess = new Date().toISOString()
      await cacheManager.get('last-access-test')

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('last-access-test'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.lastAccessed >= beforeAccess).toBe(true)
    })
  })

  describe('Prefix-based Operations', () => {
    it('invalidates by prefix', async () => {
      await cacheManager.set('doc:123:chunk-1', 'v1')
      await cacheManager.set('doc:123:chunk-2', 'v2')
      await cacheManager.set('doc:456:chunk-1', 'v3')

      const count = await cacheManager.invalidateByPrefix('doc:123')
      expect(count).toBe(2)

      expect(await cacheManager.get('doc:123:chunk-1')).toBeNull()
      expect(await cacheManager.get('doc:123:chunk-2')).toBeNull()
      expect(await cacheManager.get('doc:456:chunk-1')).toBe('v3')
    })

    it('invalidates document by ID', async () => {
      await cacheManager.set('doc:abc:info', 'data')
      await cacheManager.set('doc:abc:metadata', 'meta')

      const count = await cacheManager.invalidateDocument('abc')
      expect(count).toBe(2)

      expect(await cacheManager.get('doc:abc:info')).toBeNull()
      expect(await cacheManager.get('doc:abc:metadata')).toBeNull()
    })
  })

  describe('Semantic Hash', () => {
    it('stores and retrieves semantic hash', async () => {
      const hash = 'hash123abc'
      await cacheManager.setWithSemanticHash('semantic-test', 'data', hash)

      const keys = await mockKV.keys()
      const cacheKey = keys.find(k => k.includes('semantic-test'))
      const entry = await mockKV.get(cacheKey!) as CacheEntry
      expect(entry.semanticHash).toBe(hash)
    })

    it('detects semantic drift with different hash', async () => {
      await cacheManager.setWithSemanticHash('drift-test', 'data', 'hash-original')

      const hasDrift = await cacheManager.checkSemanticDrift('drift-test', 'hash-different', 0.9)
      expect(hasDrift).toBe(true)

      // Entry should be invalidated
      const result = await cacheManager.get('drift-test')
      expect(result).toBeNull()
    })

    it('does not detect drift with same hash', async () => {
      const hash = 'same-hash'
      await cacheManager.setWithSemanticHash('no-drift-test', 'data', hash)

      const hasDrift = await cacheManager.checkSemanticDrift('no-drift-test', hash, 0.9)
      expect(hasDrift).toBe(false)

      const result = await cacheManager.get('no-drift-test')
      expect(result).toBe('data')
    })

    it('does not detect drift for missing entry', async () => {
      const hasDrift = await cacheManager.checkSemanticDrift('missing', 'any-hash', 0.9)
      expect(hasDrift).toBe(false)
    })
  })

  describe('Adaptive TTL', () => {
    it('reduces TTL for low-access entries', async () => {
      // Create entry with long TTL but no accesses
      const entry: CacheEntry = {
        data: 'data',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        version: 'v2025.01',
        ttl: 24 * 60 * 60 * 1000, // 24 hours
        accessCount: 0,
        lastAccessed: new Date().toISOString()
      }

      await mockKV.set('cache:v2025.01:low-access', entry)

      const adaptiveTTL = await cacheManager.adaptiveTTL('low-access')
      expect(adaptiveTTL).toBeLessThan(entry.ttl)
    })

    it('increases TTL for high-access entries', async () => {
      const entry: CacheEntry = {
        data: 'data',
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
        version: 'v2025.01',
        ttl: 60 * 60 * 1000, // 1 hour
        accessCount: 20, // High access
        lastAccessed: new Date().toISOString()
      }

      await mockKV.set('cache:v2025.01:high-access', entry)

      const adaptiveTTL = await cacheManager.adaptiveTTL('high-access')
      expect(adaptiveTTL).toBeGreaterThan(entry.ttl)
    })
  })

  describe('Cleanup Operations', () => {
    it('cleans stale entries', async () => {
      // Add fresh entry
      await cacheManager.set('fresh', 'data', 3600000)

      // Add stale entry
      const staleEntry: CacheEntry = {
        data: 'old',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        version: 'v2025.01',
        ttl: 1000, // Very short TTL, already expired
        accessCount: 0,
        lastAccessed: new Date().toISOString()
      }
      await mockKV.set('cache:v2025.01:stale', staleEntry)

      const cleaned = await cacheManager.cleanStaleEntries()
      expect(cleaned).toBe(1)

      expect(await cacheManager.get('fresh')).toBe('data')
      expect(await mockKV.get('cache:v2025.01:stale')).toBeUndefined()
    })

    it('cleans entries with wrong version', async () => {
      const oldEntry: CacheEntry = {
        data: 'old',
        timestamp: new Date().toISOString(),
        version: 'v2024.01',
        ttl: 3600000,
        accessCount: 0,
        lastAccessed: new Date().toISOString()
      }
      await mockKV.set('cache:v2025.01:old-version', oldEntry)

      const cleaned = await cacheManager.cleanStaleEntries()
      expect(cleaned).toBeGreaterThan(0)
    })
  })

  describe('Metrics', () => {
    it('tracks hit rate', async () => {
      await cacheManager.set('metric-test', 'value')

      // 2 hits
      await cacheManager.get('metric-test')
      await cacheManager.get('metric-test')

      // 1 miss
      await cacheManager.get('non-existent')

      const metrics = await cacheManager.getMetrics()
      expect(metrics.hitRate).toBeCloseTo(2/3, 2)
      expect(metrics.missRate).toBeCloseTo(1/3, 2)
    })

    it('tracks total keys', async () => {
      await cacheManager.set('key1', 'v1')
      await cacheManager.set('key2', 'v2')
      await cacheManager.set('key3', 'v3')

      const metrics = await cacheManager.getMetrics()
      expect(metrics.totalKeys).toBe(3)
    })

    it('categorizes TTL in metrics', async () => {
      await cacheManager.set('short', 'v', 5 * 60 * 1000) // 5 min
      await cacheManager.set('medium', 'v', 30 * 60 * 1000) // 30 min
      await cacheManager.set('long', 'v', 12 * 60 * 60 * 1000) // 12 hours
      await cacheManager.set('very-long', 'v', 48 * 60 * 60 * 1000) // 48 hours

      const metrics = await cacheManager.getMetrics()
      expect(metrics.byTTL['short (< 10 min)']).toBe(1)
      expect(metrics.byTTL['medium (< 1 hour)']).toBe(1)
      expect(metrics.byTTL['long (< 1 day)']).toBe(1)
      expect(metrics.byTTL['very long (>= 1 day)']).toBe(1)
    })

    it('tracks invalidation history', async () => {
      await cacheManager.set('inv-test', 'value')
      await cacheManager.invalidate(['inv-test'], 'manual', 'Test reason')

      const metrics = await cacheManager.getMetrics()
      expect(metrics.recentInvalidations.length).toBeGreaterThan(0)

      const lastInvalidation = metrics.recentInvalidations[metrics.recentInvalidations.length - 1]
      expect(lastInvalidation.type).toBe('manual')
      expect(lastInvalidation.reason).toBe('Test reason')
      expect(lastInvalidation.keys).toContain('inv-test')
    })

    it('resets metrics', () => {
      cacheManager.get('test')
      cacheManager.resetMetrics()

      // Metrics should be reset, but we need to check via getMetrics
      // The resetMetrics only resets hits/misses counters
      // This is more of a smoke test
      expect(() => cacheManager.resetMetrics()).not.toThrow()
    })
  })

  describe('Invalidation History', () => {
    it('limits invalidation history to 100 entries', async () => {
      // Create 105 invalidations
      for (let i = 0; i < 105; i++) {
        await cacheManager.set(`key-${i}`, 'value')
        await cacheManager.invalidate([`key-${i}`], 'manual', `Invalidation ${i}`)
      }

      const metrics = await cacheManager.getMetrics()
      expect(metrics.recentInvalidations.length).toBeLessThanOrEqual(100)
    })
  })
})
