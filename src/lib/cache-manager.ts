import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

export interface CacheEntry<T = unknown> {
  data: T
  timestamp: string
  version: string
  ttl: number
  accessCount: number
  lastAccessed: string
  semanticHash?: string
}

export interface GuidanceProfile {
  // shape is flexible; keep minimal to avoid coupling
  completionStyle?: string
  loggingLevel?: 'info' | 'debug' | 'warn' | 'error'
  pageSize?: number
  maxPages?: number
}

const missingKeyLogCache = new Set<string>()
// Track missing keys with expiry to avoid repeated 404 fetches (key -> expiry timestamp)
const missingKeyExpiry = new Map<string, number>()
const MISSING_KEY_TTL_MS = 5 * 60 * 1000 // 5 minutes

const DEFAULT_GUIDANCE: Record<string, GuidanceProfile> = {
  'cache:v2025.01:doc-analysis:Completion.md': {
    completionStyle: 'concise-expert'
  },
  'cache:v2025.01:doc-analysis:Logging.md': {
    loggingLevel: 'info'
  },
  'cache:v2025.01:doc-analysis:Pagination.md': {
    pageSize: 50,
    maxPages: 10
  },
  'cache:v2025.01:doc-analysis:Authorization.md': {
    completionStyle: 'secure-strict'
  },
  'cache:v2025.01:doc-analysis:Lifecycle.md': {
    completionStyle: 'detailed'
  },
  'cache:v2025.01:doc-analysis:Overview.md': {
    completionStyle: 'comprehensive'
  },
  'cache:v2025.01:doc-analysis:Security Best Practices.md': {
    completionStyle: 'secure-strict',
    loggingLevel: 'warn'
  }
}

/**
 * Fetch a guidance doc/config from KV with robust fallback:
 * - On 200: return parsed content.
 * - On 404: log once per key, return default (if configured) or null.
 * - On transient errors: minimal retry, then fall back.
 */
export async function getFromKVWithFallback<T = unknown>(
  key: string,
  fetcher: (key: string) => Promise<Response>,
  options?: { parseJson?: boolean; retries?: number }
): Promise<T | null> {
  // Check negative cache to avoid repeated 404s
  const cachedExpiry = missingKeyExpiry.get(key)
  if (cachedExpiry && cachedExpiry > Date.now()) {
    // Key is known to be missing, return default without re-fetching
    const fallback = (DEFAULT_GUIDANCE[key] as T | undefined) ?? null
    return fallback
  }

  const retries = options?.retries ?? 1
  let attempt = 0

  while (true) {
    try {
      const res = await fetcher(key)

      if (res.status === 404) {
        // Add to negative cache to prevent repeated fetches
        missingKeyExpiry.set(key, Date.now() + MISSING_KEY_TTL_MS)

        if (!missingKeyLogCache.has(key)) {
          missingKeyLogCache.add(key)
          console.warn(`[kv] Guidance key missing: ${key} (using defaults if available)`)
        }
        const fallback = (DEFAULT_GUIDANCE[key] as T | undefined) ?? null
        return fallback
      }

      if (!res.ok) {
        // Non-404: transient/infra errors, allow small retry then fallback
        if (attempt < retries && isTransientStatus(res.status)) {
          attempt++
          await new Promise(r => setTimeout(r, 200 * attempt))
          continue
        }
        console.warn(
          `[kv] Failed to load key=${key}, status=${res.status} (using defaults if available)`
        )
        const fallback = (DEFAULT_GUIDANCE[key] as T | undefined) ?? null
        return fallback
      }

      // Successfully fetched, clear from negative cache if present
      missingKeyExpiry.delete(key)

      const text = await res.text()
      if (options?.parseJson) {
        try {
          return JSON.parse(text) as T
        } catch {
          console.warn(`[kv] Invalid JSON for key=${key}, returning raw text`)
        }
      }
      return text as unknown as T
    } catch (err) {
      if (attempt < retries) {
        attempt++
        await new Promise(r => setTimeout(r, 200 * attempt))
        continue
      }
      console.warn(
        `[kv] Error fetching key=${key}: ${
          err instanceof Error ? err.message : String(err)
        } (using defaults if available)`
      )
      const fallback = (DEFAULT_GUIDANCE[key] as T | undefined) ?? null
      return fallback
    }
  }

  function isTransientStatus(status: number): boolean {
    return [429, 500, 502, 503, 504].includes(status)
  }
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

const localStorageAdapter: CloudflareKVAdapter = {
  async keys(): Promise<string[]> {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k) keys.push(k)
    }
    return keys
  },
  async get(key: string): Promise<unknown> {
    if (typeof window === 'undefined' || !window.localStorage) return undefined
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined
    try { return JSON.parse(raw) } catch { return raw }
  },
  async set(key: string, value: unknown): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) return
    const payload = typeof value === 'string' ? value : JSON.stringify(value)
    window.localStorage.setItem(key, payload)
  },
  async delete(key: string): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(key)
  }
}

export class CacheManager {
  private readonly CACHE_VERSION = 'v2025.01'
  private readonly DEFAULT_TTL_MS = 3600000
  private invalidationHistory: CacheInvalidationEvent[] = []
  private hits = 0
  private misses = 0
  private kv: CloudflareKVAdapter
  private static hasLogged = false

  constructor(kv?: CloudflareKVAdapter | null) {
    const cf = kv ?? createCloudflareKV()
    this.kv = cf || localStorageAdapter
    // Only log once per runtime to reduce noise
    if (!CacheManager.hasLogged) {
      if (cf) {
        console.info('[cache-manager] Using Cloudflare KV')
      } else {
        console.info('[cache-manager] Using localStorage fallback')
      }
      CacheManager.hasLogged = true
    }
  }

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
      lastAccessed: new Date().toISOString(),
    }
    const cacheKey = this.buildCacheKey(key)
    await this.kv.set(cacheKey, entry)
  }

  async get<T>(key: string): Promise<T | null> {
    const cacheKey = this.buildCacheKey(key)
    const rawEntry = await this.kv.get(cacheKey)
    const entry = rawEntry as CacheEntry<T> | undefined

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
    await this.kv.set(cacheKey, entry)

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
      await this.kv.delete(cacheKey)
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
    const allKeys = await this.kv.keys()
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
    await this.kv.set(cacheKey, entry)
  }

  async checkSemanticDrift(
    key: string,
    currentHash: string,
    threshold: number = 0.9
  ): Promise<boolean> {
    const cacheKey = this.buildCacheKey(key)
    const rawEntry = await this.kv.get(cacheKey)
    const entry = rawEntry as CacheEntry | undefined
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
    const rawEntry = await this.kv.get(cacheKey)
    const entry = rawEntry as CacheEntry | undefined
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
    const allKeys = await this.kv.keys()
    const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
    let cleaned = 0
    for (const cacheKey of cacheKeys) {
      const rawEntry = await this.kv.get(cacheKey)
      const entry = rawEntry as CacheEntry | undefined
      if (!entry) continue
      if (this.isStale(entry) || entry.version !== this.CACHE_VERSION) {
        await this.kv.delete(cacheKey)
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
    const allKeys = await this.kv.keys()
    const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
    const byTTL: Record<string, number> = {}
    let totalAge = 0
    let staleEntries = 0
    for (const cacheKey of cacheKeys) {
      const rawEntry = await this.kv.get(cacheKey)
      const entry = rawEntry as CacheEntry | undefined
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

export const cacheManager = new CacheManager(createCloudflareKV())
