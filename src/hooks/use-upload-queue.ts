import { useState, useCallback, useEffect } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import { errorTracking } from '@/lib/services/error-tracker'

export type UploadQueueStatus =
  | 'pending'
  | 'uploading'
  | 'completed'
  | 'error'
  | 'paused'

export interface UploadQueueChunk {
  index: number
  start: number
  end: number
  uploaded: boolean
  attempts: number
}

export interface UploadQueueItem {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  createdAt: string
  status: UploadQueueStatus
  progress: number
  error?: string
  lastUpdatedAt: string
  documentId?: string
  totalChunks: number
  chunks: UploadQueueChunk[]
}

const DB_NAME = 'pf-upload-queue-v1'
const STORE_NAME = 'uploads'
const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_RETRIES = 3

let dbPromise: Promise<IDBPDatabase> | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db: IDBPDatabase) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
      }
    })
  }
  return dbPromise
}

async function persistItem(item: UploadQueueItem): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE_NAME, item)
  } catch (error) {
    errorTracking.record(error as Error, {
      type: 'runtime',
      agent: 'useUploadQueue',
      code: 'persist_failed'
    })
  }
}

async function deleteItem(id: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete(STORE_NAME, id)
  } catch (error) {
    errorTracking.record(error as Error, {
      type: 'runtime',
      agent: 'useUploadQueue',
      code: 'delete_failed'
    })
  }
}

async function loadAllItems(): Promise<UploadQueueItem[]> {
  try {
    const db = await getDB()
    return (await db.getAll(STORE_NAME)) as UploadQueueItem[]
  } catch (error) {
    errorTracking.record(error as Error, {
      type: 'runtime',
      agent: 'useUploadQueue',
      code: 'load_failed'
    })
    return []
  }
}

function createChunks(fileSize: number): UploadQueueChunk[] {
  const chunks: UploadQueueChunk[] = []
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, fileSize)
    chunks.push({
      index: i,
      start,
      end,
      uploaded: false,
      attempts: 0
    })
  }

  return chunks
}

async function uploadChunkToWorker(
  file: File,
  item: UploadQueueItem,
  chunk: UploadQueueChunk
): Promise<void> {
  const blob = file.slice(chunk.start, chunk.end)
  const formData = new FormData()
  formData.append('chunk', blob)
  formData.append('documentId', item.documentId ?? item.id)
  formData.append('chunkIndex', String(chunk.index))

  const resp = await fetch('/api/upload-chunk', {
    method: 'POST',
    body: formData
  })

  if (!resp.ok) {
    throw new Error(
      `Chunk upload failed (${chunk.index}): ${resp.status} ${resp.statusText}`
    )
  }
}

async function finalizeWorkerUpload(item: UploadQueueItem): Promise<void> {
  const resp = await fetch('/api/upload-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: item.documentId ?? item.id,
      fileName: item.fileName,
      fileType: item.fileType || 'application/octet-stream',
      totalChunks: item.totalChunks
    })
  })

  if (!resp.ok) {
    const message = await resp.text().catch(() => '')
    throw new Error(
      `Failed to finalize upload: ${resp.status} ${resp.statusText}${
        message ? ` - ${message}` : ''
      }`
    )
  }
}

/**
 * useUploadQueue
 *
 * - IndexedDB-backed queue of uploads.
 * - Each entry:
 *   - Persists file metadata and chunk states.
 *   - Survives refresh; processing can resume on reload.
 * - Integrates with existing Worker large-file endpoints for chunking.
 *
 * NOTE: This hook manages persistence and network I/O state. The parent
 *       (DocumentUpload) remains responsible for turning a completed file
 *       into a Document via existing ingestion (intelligentChunkDocument, etc).
 */
export function useUploadQueue() {
  const [queue, setQueue] = useState<UploadQueueItem[]>([])
  const [processing, setProcessing] = useState(false)

  // Initial load
  useEffect(() => {
    ;(async () => {
      const items = await loadAllItems()
      setQueue(items)
    })()
  }, [])

  const addFile = useCallback(
    async (file: File): Promise<UploadQueueItem> => {
      const id = `upload-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`
      const chunks = createChunks(file.size)
      const item: UploadQueueItem = {
        id,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        createdAt: new Date().toISOString(),
        status: 'pending',
        progress: 0,
        lastUpdatedAt: new Date().toISOString(),
        documentId: id,
        totalChunks: chunks.length,
        chunks
      }

      await persistItem(item)
      setQueue((prev) => [...prev, item])
      return item
    },
    []
  )

  const markItem = useCallback(
    async (id: string, patch: Partial<UploadQueueItem>) => {
      setQueue((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, ...patch, lastUpdatedAt: new Date().toISOString() } : item
        )
        return next
      })

      try {
        const db = await getDB()
        const existing = (await db.get(STORE_NAME, id)) as UploadQueueItem | undefined
        if (existing) {
          const updated: UploadQueueItem = {
            ...existing,
            ...patch,
            lastUpdatedAt: new Date().toISOString()
          }
          await db.put(STORE_NAME, updated)
        }
      } catch (error) {
        errorTracking.record(error as Error, {
          type: 'runtime',
          agent: 'useUploadQueue',
          code: 'mark_failed'
        })
      }
    },
    []
  )

  const remove = useCallback(async (id: string) => {
    await deleteItem(id)
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }, [])

  /**
   * Process queue:
   * - Attempts pending/error items.
   * - Streams chunks to Worker with retry/backoff.
   * - Finalizes via /api/upload-complete.
   * - On success: marks completed, caller can react to completion.
   */
  const processQueue = useCallback(
    async (resolveFile: (fileName: string) => File | null) => {
      if (processing) return
      setProcessing(true)

      try {
        let items = await loadAllItems()

        for (const item of items) {
          if (
            item.status !== 'pending' &&
            item.status !== 'error' &&
            item.status !== 'paused'
          ) {
            continue
          }

          const file = resolveFile(item.fileName)
          if (!file || file.size !== item.fileSize) {
            // Cannot resume without matching File handle; leave as pending.
            continue
          }

          await markItem(item.id, { status: 'uploading' })

          let uploadedChunks = item.chunks.filter((c) => c.uploaded).length

          for (const chunk of item.chunks) {
            if (chunk.uploaded) continue

            let attempts = chunk.attempts || 0
            let success = false

            while (attempts < MAX_RETRIES && !success) {
              try {
                await uploadChunkToWorker(file, item, chunk)
                uploadedChunks += 1

                const updatedChunk: UploadQueueChunk = {
                  ...chunk,
                  uploaded: true,
                  attempts
                }

                // Update chunk state locally and in DB
                item.chunks = item.chunks.map((c) =>
                  c.index === chunk.index ? updatedChunk : c
                )

                const pct = Math.floor(
                  (uploadedChunks / item.totalChunks) * 90
                )

                await markItem(item.id, {
                  chunks: item.chunks,
                  progress: pct,
                  status: 'uploading'
                })

                success = true
              } catch (error) {
                attempts += 1
                chunk.attempts = attempts

                if (attempts >= MAX_RETRIES) {
                  const message =
                    error instanceof Error
                      ? error.message
                      : 'Unknown upload error'
                  await markItem(item.id, {
                    status: 'error',
                    error: `Chunk ${chunk.index + 1} failed: ${message}`
                  })
                  errorTracking.record(error as Error, {
                    type: 'runtime',
                    agent: 'useUploadQueue',
                    code: 'chunk_failed'
                  })
                  success = false
                  break
                }

                // Simple backoff
                await new Promise((resolve) =>
                  setTimeout(resolve, 500 * attempts)
                )
              }
            }

            if (!success) {
              // Stop processing this item; move to next
              break
            }
          }

          // If all chunks uploaded, finalize
          if (
            item.chunks.every((c) => c.uploaded) &&
            (await loadAllItems()).find((i) => i.id === item.id)?.status !==
              'error'
          ) {
            try {
              await finalizeWorkerUpload(item)
              await markItem(item.id, {
                status: 'completed',
                progress: 100
              })
            } catch (error) {
              await markItem(item.id, {
                status: 'error',
                error:
                  error instanceof Error
                    ? error.message
                    : 'Failed to finalize upload'
              })
              errorTracking.record(error as Error, {
                type: 'runtime',
                agent: 'useUploadQueue',
                code: 'finalize_failed'
              })
            }
          }
        }

        // Refresh in-memory queue from DB at the end
        items = await loadAllItems()
        setQueue(items)
      } finally {
        setProcessing(false)
      }
    },
    [processing, markItem]
  )

  return {
    queue,
    processing,
    addFile,
    processQueue,
    remove
  }
}
