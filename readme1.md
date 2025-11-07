I'll create a clean, simplified implementation that removes all GitHub Spark code and gives you a straightforward two-tier storage system.I'll provide the complete cleaned - up implementation files for you to create.Here's the simplified storage system:

## ** File 1: `src/lib/storage.ts`(New - 260 lines) **

  ```typescript
/**
 * Simplified Storage Adapter
 *
 * Two-tier system:
 * 1. Cloudflare KV (production) - via Worker API at /api/kv
 * 2. localStorage (development/fallback)
 *
 * No fetch interception, no window.spark wrapper, no over-engineering.
 */

const LOG_PREFIX = '[storage]'

// ============================================================================
// Storage Interface
// ============================================================================

export interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

// ============================================================================
// Cloudflare KV Storage (Production)
// ============================================================================

class CloudflareKVStorage implements StorageAdapter {
  private baseUrl = '/api/kv'

  private getAuthToken(): string | undefined {
    // Try localStorage first (for development), then env var
    if (typeof window !== 'undefined') {
      const token = window.localStorage?.getItem('KV_API_KEY')
      if (token) return token
    }
    return import.meta.env.VITE_KV_API_KEY
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getAuthToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    }

    if (token) {
      headers['Authorization'] = `Bearer ${ token } `
    }

    const response = await fetch(`${ this.baseUrl }${ path } `, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText)
      throw new Error(`KV API error(${ response.status }): ${ error } `)
    }

    return response
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const response = await this.request(`/ ${ encodeURIComponent(key) } `)
      return await response.json() as T
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('404')) {
        return undefined
      }
      console.error(`${ LOG_PREFIX } Failed to get key "${key}": `, error)
      throw error
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    try {
      await this.request(`/ ${ encodeURIComponent(key) } `, {
        method: 'POST',
        body: JSON.stringify(value),
      })
      console.debug(`${ LOG_PREFIX } Set key "${key}"`)
    } catch (error) {
      console.error(`${ LOG_PREFIX } Failed to set key "${key}": `, error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.request(`/ ${ encodeURIComponent(key) } `, {
        method: 'DELETE',
      })
      console.debug(`${ LOG_PREFIX } Deleted key "${key}"`)
    } catch (error: unknown) {
      // Ignore 404 on delete
      if (error instanceof Error && !error.message.includes('404')) {
        console.error(`${ LOG_PREFIX } Failed to delete key "${key}": `, error)
        throw error
      }
    }
  }

  async keys(): Promise<string[]> {
    try {
      const response = await this.request('')
      const data = await response.json() as {
        keys: string[]
        cursor: string | null
      }

      // Handle pagination if needed
      let allKeys = [...data.keys]
      let cursor = data.cursor

      while (cursor) {
        const nextResponse = await this.request(`? cursor = ${ encodeURIComponent(cursor) } `)
        const nextData = await nextResponse.json() as {
          keys: string[]
          cursor: string | null
        }
        allKeys = [...allKeys, ...nextData.keys]
        cursor = nextData.cursor
      }

      return allKeys
    } catch (error) {
      console.error(`${ LOG_PREFIX } Failed to list keys: `, error)
      throw error
    }
  }
}

// ============================================================================
// localStorage Storage (Development/Fallback)
// ============================================================================

class LocalStorage implements StorageAdapter {
  private prefix = 'kv:'

  private getKey(key: string): string {
    return `${ this.prefix }${ key } `
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const raw = window.localStorage.getItem(this.getKey(key))
      if (!raw) return undefined
      return JSON.parse(raw) as T
    } catch (error) {
      console.error(`${ LOG_PREFIX } localStorage get failed: `, error)
      return undefined
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    try {
      window.localStorage.setItem(this.getKey(key), JSON.stringify(value))
    } catch (error) {
      console.error(`${ LOG_PREFIX } localStorage set failed: `, error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(this.getKey(key))
    } catch (error) {
      console.error(`${ LOG_PREFIX } localStorage delete failed: `, error)
    }
  }

  async keys(): Promise<string[]> {
    try {
      const allKeys: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (key?.startsWith(this.prefix)) {
          allKeys.push(key.slice(this.prefix.length))
        }
      }
      return allKeys
    } catch (error) {
      console.error(`${ LOG_PREFIX } localStorage keys failed: `, error)
      return []
    }
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

function isCloudflareWorkers(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.includes('.workers.dev') ||
         import.meta.env.VITE_USE_CLOUDFLARE_KV === 'true'
}

function createStorage(): StorageAdapter {
  if (typeof window === 'undefined') {
    // SSR - return a no-op adapter
    return {
      async get() { return undefined },
      async set() {},
      async delete() {},
      async keys() { return [] },
    }
  }

  if (isCloudflareWorkers()) {
    console.info(`${ LOG_PREFIX } Using Cloudflare KV`)
    return new CloudflareKVStorage()
  }

  console.info(`${ LOG_PREFIX } Using localStorage(set VITE_USE_CLOUDFLARE_KV = true to use KV in dev)`)
  return new LocalStorage()
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const storage = createStorage()

// ============================================================================
// Testing Helper
// ============================================================================

export async function testStorage(): Promise<boolean> {
  try {
    const testKey = '_storage_test'
    const testValue = { test: true, timestamp: Date.now() }

    await storage.set(testKey, testValue)
    const retrieved = await storage.get<typeof testValue>(testKey)
    await storage.delete(testKey)

    const matches = retrieved?.test === testValue.test

    if (matches) {
      console.info(`${ LOG_PREFIX } Storage test passed`)
    } else {
      console.error(`${ LOG_PREFIX } Storage test failed - value mismatch`)
    }

    return matches
  } catch (error) {
    console.error(`${ LOG_PREFIX } Storage test failed: `, error)
    return false
  }
}
```

## ** File 2: `src/hooks/useStorage.ts`(New - 75 lines) **

  ```typescript
import { useState, useEffect, useCallback } from 'react'
import { storage } from '@/lib/storage'

type Setter<T> = T | ((prev: T | undefined) => T)

/**
 * Simple React hook for persistent storage
 *
 * Automatically syncs to Cloudflare KV (production) or localStorage (dev)
 * Returns [value, setter, deleter] tuple like useState
 */
export function useStorage<T>(key: string, initialValue?: T) {
  const [value, setValue] = useState<T | undefined>(initialValue)
  const [loading, setLoading] = useState(true)

  // Load initial value from storage
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const stored = await storage.get<T>(key)

        if (cancelled) return

        if (stored !== undefined) {
          setValue(stored)
        } else if (initialValue !== undefined) {
          setValue(initialValue)
          await storage.set(key, initialValue)
        }
      } catch (error) {
        console.error(`useStorage: Failed to load key "${key}"`, error)
        setValue(initialValue)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [key, initialValue])

  // Setter function
  const setStoredValue = useCallback(
    async (newValue: Setter<T>) => {
      const resolved = typeof newValue === 'function'
        ? (newValue as (prev: T | undefined) => T)(value)
        : newValue

      setValue(resolved)

      try {
        await storage.set(key, resolved)
      } catch (error) {
        console.error(`useStorage: Failed to set key "${key}"`, error)
      }
    },
    [key, value]
  )

  // Delete function
  const deleteValue = useCallback(async () => {
    setValue(undefined)

    try {
      await storage.delete(key)
    } catch (error) {
      console.error(`useStorage: Failed to delete key "${key}"`, error)
    }
  }, [key])

  return [value, setStoredValue, deleteValue, loading] as const
}
```

## ** Files to DELETE:**

  1. ✅ ** DELETE ** `src/lib/spark-fallback.ts`(entire file ~500 + lines)
2. ✅ ** DELETE ** `src/hooks/use-spark-kv.ts`(entire file - replaced by useStorage)
3. ✅ ** DELETE ** `src/lib/cloudflare-kv.ts`(replaced by simpler storage.ts)

## ** Files to UPDATE:**

### ** File 3: Update all imports throughout the codebase **

  Replace:
```typescript
import { useSparkKV } from '@/hooks/use-spark-kv'
```

With:
```typescript
import { useStorage } from '@/hooks/useStorage'
```

Replace:
```typescript
const [value, setValue, deleteValue] = useSparkKV('key', defaultValue)
```

With:
```typescript
const [value, setValue, deleteValue, loading] = useStorage('key', defaultValue)
```

### ** File 4: `worker/index.ts` - Remove Spark endpoint **

  Remove this section:
```typescript
// Health/ping for Spark front-end integrations
if (url.pathname === '/_spark/loaded') {
  // ... remove entire block
}
```

Also update ALLOWED_ORIGINS:
```typescript
const ALLOWED_ORIGINS = [
  // Remove: 'https://spark.example.com',
  // Remove: 'https://staging.spark.example.com',
  'https://paradigmfind.com',
  'https://www.paradigmfind.com',
]
```

### ** File 5: Update`src/lib/config.ts` **

  Remove or update `isCloudflareWorkers()` to be simpler:
```typescript
export const runtime = {
  isCloudflareWorkers(): boolean {
    if (typeof window === 'undefined') return false
    return window.location.hostname.includes('.workers.dev') ||
           envBool('VITE_USE_CLOUDFLARE_KV', false)
  },

  // Remove isCloudflareKVConfigured - no longer needed

  getStorageMode(): 'cloudflare' | 'local' {
    return this.isCloudflareWorkers() ? 'cloudflare' : 'local'
  }
}
```

### ** File 6: Update services that reference Spark **

  Update`src/lib/services/query-history.ts`:
```typescript
// Replace:
import { getActiveSparkKv, fallbackKv } from '../spark-fallback'

// With:
import { storage } from '@/lib/storage'

// Replace usage:
const value = await storage.get<QueryHistoryEntry[]>(KV_KEY)
await storage.set(KV_KEY, payload)
```

Update`src/lib/services/token-tracker.ts` - remove the `StorageManager` class and use `storage` directly.

## ** Summary of Changes **

** Before:** 850 + lines across 3 files with fetch interception
  ** After:** 335 lines across 2 clean files

    ** Removed concepts:**
      - GitHub Spark `window.spark` API
        - `/_spark/*` endpoints
          - Fetch interception
            - Triple - layer abstraction
              - "remote" vs "cloudflare" vs "local" modes
                - REST API dual - mode support

                  ** Simple flow:**
                    ```
Production:  useStorage → storage → CloudflareKVStorage → /api/kv → Worker
Development: useStorage → storage → LocalStorage → window.localStorage
```

Would you like me to show specific file replacements for any of the services that use the old system ?
