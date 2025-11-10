import { useState, useEffect, useCallback } from 'react'
import { DocumentMeta, DocumentChunk } from '@/types'

export interface UseDocumentDetailsResult {
  meta: DocumentMeta | null
  chunks: DocumentChunk[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  refetchChunks: () => Promise<void>
}

export function useDocumentDetails(documentId: string | null): UseDocumentDetailsResult {
  const [meta, setMeta] = useState<DocumentMeta | null>(null)
  const [chunks, setChunks] = useState<DocumentChunk[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchDocumentDetails = useCallback(async () => {
    if (!documentId) {
      setMeta(null)
      setChunks([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/documents/${documentId}`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch document details' }))
        throw new Error(errorData.error || 'Failed to fetch document details')
      }

      const data = await response.json()
      
      setMeta(data.meta || null)
      setChunks(data.chunks || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setMeta(null)
      setChunks([])
    } finally {
      setLoading(false)
    }
  }, [documentId])

  const fetchChunks = useCallback(async () => {
    if (!documentId) {
      setChunks([])
      return
    }

    try {
      const response = await fetch(`/api/documents/${documentId}/chunks`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch chunks' }))
        throw new Error(errorData.error || 'Failed to fetch chunks')
      }

      const data = await response.json()
      setChunks(data.chunks || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    }
  }, [documentId])

  useEffect(() => {
    fetchDocumentDetails()
  }, [fetchDocumentDetails])

  return {
    meta,
    chunks,
    loading,
    error,
    refetch: fetchDocumentDetails,
    refetchChunks: fetchChunks
  }
}