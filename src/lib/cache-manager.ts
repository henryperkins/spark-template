export interface CacheEntry<T = any> {
  data: T
  timestamp: string
  version: string
  ttl: number
  accessCount: number
  lastAccessed: string
  semanticHash?: string
}

export interface CacheInvalidationEvent {
  type: 'ttl' | 'version' | 'prefix' | 'semantic' | 'manual'
  keys: string[]
  reason: string
  timestamp: string
}

export interface CacheMetrics {
  totalKeys: number
  hitRate: number
  missRate: number
  averageAge: number
  staleEntries: number
  byTTL: Record<string, number>
  recentInvalidations: CacheInvalidationEvent[]
}

export class CacheManager {
  private readonly CACHE_VERSION = 'v2025.01'
  private readonly DEFAULT_TTL_MS = 3600000
  private invalidationHistory: CacheInvalidationEvent[] = []
  private hits = 0
  private misses = 0

  private getTTLByContentType(keyPrefix: string): number {
    if (keyPrefix.includes('news') || keyPrefix.includes('realtime')) {
      return 5 * 60 * 1000
    }
    
    if (keyPrefix.includes('dynamic') || keyPrefix.includes('query')) {
      return 60 * 60 * 1000
    }
    
    if (keyPrefix.includes('static') || keyPrefix.includes('document')) {
      return 24 * 60 * 60 * 1000
    }
    
    return this.DEFAULT_TTL_MS
  }

  async set<T>(key: string, data: T, customTTL?: number): Promise<void> {
    const ttl = customTTL || this.getTTLByContentType(key)
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: new Date().toISOString(),
      version: this.CACHE_VERSION,
      ttl,
      accessCount: 0,
      lastAccessed: new Date().toISOString()
    }

    const cacheKey = this.buildCacheKey(key)
    await (window as any).spark.kv.set(cacheKey, entry)
  }

  async get<T>(key: string): Promise<T | null> {
    const cacheKey = this.buildCacheKey(key)
    const entry = await (window as any).spark.kv.get<CacheEntry<T>>(cacheKey)

    if (!entry) {
      this.misses++
      return null
    }

    if (this.isStale(entry)) {
      await this.invalidate([key], 'ttl', 'TTL expired')
      this.misses++
      return null
    }

    if (entry.version !== this.CACHE_VERSION) {
      await this.invalidate([key], 'version', `Version mismatch: ${entry.version}`)
      this.misses++
      return null
    }

    entry.accessCount++
    entry.lastAccessed = new Date().toISOString()
    await (window as any).spark.kv.set(cacheKey, entry)

    this.hits++
    return entry.data
  }

  async invalidate(
    keys: string[],
    type: CacheInvalidationEvent['type'],
    reason: string
  ): Promise<void> {
    for (const key of keys) {
      const cacheKey = this.buildCacheKey(key)
      await (window as any).spark.kv.delete(cacheKey)
    }

    const event: CacheInvalidationEvent = {
      type,
      keys,
      reason,
      timestamp: new Date().toISOString()
    }

    this.invalidationHistory.push(event)
    
    if (this.invalidationHistory.length > 100) {
      this.invalidationHistory = this.invalidationHistory.slice(-100)
    }
  }

  async invalidateByPrefix(prefix: string, reason?: string): Promise<number> {
    const allKeys = await (window as any).spark.kv.keys()
    const cachePrefix = this.buildCacheKey(prefix)
    const matchingKeys = allKeys.filter(key => key.startsWith(cachePrefix))

    const originalKeys = matchingKeys.map(key => this.extractOriginalKey(key))

    await this.invalidate(
      originalKeys,
      'prefix',
      reason || `Prefix-based invalidation: ${prefix}`
    )

    return matchingKeys.length
  }

  async invalidateDocument(documentId: string): Promise<number> {
    return await this.invalidateByPrefix(
      `doc:${documentId}`,
      `Document ${documentId} updated`
    )
  }

  async setWithSemanticHash<T>(
    key: string,
    data: T,
    semanticHash: string,
    customTTL?: number
  ): Promise<void> {
    const ttl = customTTL || this.getTTLByContentType(key)
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: new Date().toISOString(),
      version: this.CACHE_VERSION,
      ttl,
      accessCount: 0,
      lastAccessed: new Date().toISOString(),
      semanticHash
    }

    const cacheKey = this.buildCacheKey(key)
    await (window as any).spark.kv.set(cacheKey, entry)
  }

  async checkSemanticDrift(
    key: string,
    currentHash: string,
    threshold: number = 0.9
  ): Promise<boolean> {
    const cacheKey = this.buildCacheKey(key)
    const entry = await (window as any).spark.kv.get<CacheEntry>(cacheKey)

    if (!entry || !entry.semanticHash) {
      return false
    }

    const similarity = this.calculateHashSimilarity(entry.semanticHash, currentHash)
    
    if (similarity < threshold) {
      await this.invalidate([key], 'semantic', `Semantic drift detected: ${similarity.toFixed(2)}`)
      return true
    }

    return false
  }

  private calculateHashSimilarity(hash1: string, hash2: string): number {
    if (hash1 === hash2) return 1.0
    
    let matches = 0
    const length = Math.min(hash1.length, hash2.length)
    
    for (let i = 0; i < length; i++) {
      if (hash1[i] === hash2[i]) matches++
    }
    
    return matches / Math.max(hash1.length, hash2.length)
  }

  async adaptiveTTL(key: string): Promise<number> {
    const cacheKey = this.buildCacheKey(key)
    const entry = await (window as any).spark.kv.get<CacheEntry>(cacheKey)

    if (!entry) {
      return this.DEFAULT_TTL_MS
    }

    const hoursSinceCreation = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60)
    const accessFrequency = entry.accessCount / Math.max(hoursSinceCreation, 1)

    if (accessFrequency < 0.1) {
      return Math.max(entry.ttl * 0.5, 5 * 60 * 1000)
    }

    if (accessFrequency > 5) {
      return entry.ttl * 2
    }

    return entry.ttl
  }

  async cleanStaleEntries(): Promise<number> {
    const allKeys = await (window as any).spark.kv.keys()
    const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
    
    let cleaned = 0

    for (const cacheKey of cacheKeys) {
      const entry = await (window as any).spark.kv.get<CacheEntry>(cacheKey)
      
      if (!entry) continue

      if (this.isStale(entry) || entry.version !== this.CACHE_VERSION) {
        await (window as any).spark.kv.delete(cacheKey)
        cleaned++
      }
    }

    if (cleaned > 0) {
      const event: CacheInvalidationEvent = {
        type: 'ttl',
        keys: [],
        reason: `Cleanup: ${cleaned} stale entries removed`,
        timestamp: new Date().toISOString()
      }
      this.invalidationHistory.push(event)
    }

    return cleaned
  }

  async getMetrics(): Promise<CacheMetrics> {
    const allKeys = await (window as any).spark.kv.keys()
    const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
    
    const byTTL: Record<string, number> = {}
    let totalAge = 0
    let staleEntries = 0

    for (const cacheKey of cacheKeys) {
      const entry = await (window as any).spark.kv.get<CacheEntry>(cacheKey)
      
      if (!entry) continue

      const ttlCategory = this.categorizeTTL(entry.ttl)
      byTTL[ttlCategory] = (byTTL[ttlCategory] || 0) + 1

      const ageMs = Date.now() - new Date(entry.timestamp).getTime()
      totalAge += ageMs

      if (this.isStale(entry)) {
        staleEntries++
      }
    }

    const total = this.hits + this.misses
    const hitRate = total > 0 ? this.hits / total : 0
    const missRate = total > 0 ? this.misses / total : 0

    return {
      totalKeys: cacheKeys.length,
      hitRate,
      missRate,
      averageAge: cacheKeys.length > 0 ? totalAge / cacheKeys.length / 1000 : 0,
      staleEntries,
      byTTL,
      recentInvalidations: this.invalidationHistory.slice(-10)
    }
  }

  private categorizeTTL(ttl: number): string {
    if (ttl < 10 * 60 * 1000) return 'short (< 10 min)'
    if (ttl < 60 * 60 * 1000) return 'medium (< 1 hour)'
    if (ttl < 24 * 60 * 60 * 1000) return 'long (< 1 day)'
    return 'very long (>= 1 day)'
  }

  private isStale(entry: CacheEntry): boolean {
    const age = Date.now() - new Date(entry.timestamp).getTime()
    return age > entry.ttl
  }

  private buildCacheKey(key: string): string {
    return `cache:${this.CACHE_VERSION}:${key}`
  }

  private extractOriginalKey(cacheKey: string): string {
    const parts = cacheKey.split(':')
    return parts.slice(2).join(':')
  }

  resetMetrics(): void {
    this.hits = 0
    this.misses = 0
  }
}

export const cacheManager = new CacheManager()
