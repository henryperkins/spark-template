/**
 * Simplified KV Hook
 * Direct Cloudflare KV or localStorage - no GitHub Spark compatibility
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

type Setter<T> = T | ((oldValue?: T) => T)

const localStorageAdapter: CloudflareKVAdapter = {
  async keys(): Promise<string[]> {
    if (typeof window === 'undefined') return []
    return Object.keys(window.localStorage || {})
  },
  async get(key: string): Promise<unknown> {
    if (typeof window === 'undefined') return undefined
    const item = window.localStorage?.getItem(key)
    if (!item) return undefined
    try {
      return JSON.parse(item)
    } catch {
      return item
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    if (typeof window === 'undefined') return
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    window.localStorage?.setItem(key, serialized)
  },
  async delete(key: string): Promise<void> {
    if (typeof window === 'undefined') return
    window.localStorage?.removeItem(key)
  }
}

let cachedStorage: CloudflareKVAdapter | null = null

function getStorage(): CloudflareKVAdapter {
  if (!cachedStorage) {
    const cloudflareKV = createCloudflareKV()
    cachedStorage = cloudflareKV || localStorageAdapter
    if (cloudflareKV) {
      console.info('[use-kv] Using Cloudflare KV for storage')
    } else {
      console.info('[use-kv] Using localStorage fallback (~5MB limit)')
    }
  }
  return cachedStorage
}

const isFunction = <T,>(value: Setter<T>): value is (oldValue?: T) => T => {
  return typeof value === 'function'
}

export function useKV<T = string>(key: string, initialValue?: NoInfer<T>) {
  const initialRef = useRef(initialValue)
  const [value, setValue] = useState<T | undefined>(initialValue)
  const storage = getStorage()

  useEffect(() => {
    let cancelled = false
    const loadValue = async () => {
      try {
        const loaded = await storage.get(key) as T | undefined
        if (cancelled) return
        if (loaded !== undefined) {
          setValue(loaded)
        } else if (initialRef.current !== undefined) {
          setValue(initialRef.current)
          await storage.set(key, initialRef.current)
        }
      } catch (error) {
        console.error(`[use-kv] Failed to load key "${key}":`, error)
        if (!cancelled && initialRef.current !== undefined) {
          setValue(initialRef.current)
        }
      }
    }
    loadValue()
    return () => { cancelled = true }
  }, [key])

  const setStoredValue = useCallback(
    (nextValue: Setter<T | undefined>) => {
      setValue(prev => {
        const resolved = isFunction(nextValue) ? nextValue(prev) : nextValue
        if (resolved !== undefined) {
          storage.set(key, resolved).catch(error => {
            console.error(`[use-kv] Failed to set key "${key}":`, error)
          })
        } else {
          storage.delete(key).catch(error => {
            console.error(`[use-kv] Failed to delete key "${key}":`, error)
          })
        }
        return resolved
      })
    },
    [key]
  )

  const deleteValue = useCallback(() => {
    storage.delete(key).catch(error => {
      console.error(`[use-kv] Failed to delete key "${key}":`, error)
    })
    setValue(undefined)
  }, [key])

  return [value, setStoredValue, deleteValue] as const
}

export { useKV as useStorage }
