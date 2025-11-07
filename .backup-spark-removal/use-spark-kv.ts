import { useState, useEffect, useRef, useCallback } from 'react'
import { getActiveSparkKv, fallbackKv, SparkKv, installSparkFallbacks } from '@/lib/spark-fallback'

type Setter<T> = T | ((oldValue?: T) => T)

const isFunction = <T,>(value: Setter<T>): value is (oldValue?: T) => T => {
  return typeof value === 'function'
}

const cloneValue = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

const withKv = async <T>(
  key: string,
  handler: (kv: SparkKv) => Promise<T>,
  fallback: () => Promise<T>,
) => {
  try {
    const kv = getActiveSparkKv()
    return await handler(kv)
  } catch (error) {
    console.warn(`[spark-kv] Falling back for key "${key}":`, error)
    return fallback()
  }
}

export function useSparkKV<T = string>(key: string, initialValue?: NoInfer<T>) {
  const initialRef = useRef(initialValue)
  const [value, setValue] = useState<T | undefined>(initialValue)

  // Ensure fallbacks are installed once the hook is used
  useEffect(() => {
    installSparkFallbacks()
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadValue = async () => {
      const resolved = await withKv(
        key,
        async (kv) => kv.get(key) as Promise<T | undefined>,
        async () => fallbackKv.get(key) as Promise<T | undefined>,
      )

      if (cancelled) {
        return
      }

      if (typeof resolved === 'undefined') {
        setValue(initialRef.current)
        if (typeof initialRef.current !== 'undefined') {
          await withKv(
            key,
            async (kv) => kv.set(key, cloneValue(initialRef.current)),
            async () => fallbackKv.set(key, cloneValue(initialRef.current)),
          )
        }
      } else {
        setValue(resolved)
      }
    }

    loadValue()

    return () => {
      cancelled = true
    }
  }, [key])

  const setStoredValue = useCallback(
    (nextValue: Setter<T | undefined>) => {
      setValue(prev => {
        const resolved = isFunction(nextValue) ? nextValue(prev) : nextValue
        if (typeof resolved === 'undefined') {
          withKv(
            key,
            async (kv) => kv.delete(key),
            async () => fallbackKv.delete(key),
          ).catch(error => {
            console.warn(`[spark-kv] Failed to delete key "${key}":`, error)
          })
        } else {
          const payload = cloneValue(resolved)
          withKv(
            key,
            async (kv) => kv.set(key, payload),
            async () => fallbackKv.set(key, payload),
          ).catch(error => {
            console.warn(`[spark-kv] Failed to persist key "${key}":`, error)
          })
        }

        return resolved
      })
    },
    [key],
  )

  const deleteValue = useCallback(() => {
    withKv(
      key,
      async (kv) => kv.delete(key),
      async () => fallbackKv.delete(key),
    ).catch(error => {
      console.warn(`[spark-kv] Failed to delete key "${key}":`, error)
    })

    setValue(undefined)
  }, [key])

  return [value, setStoredValue, deleteValue] as const
}
