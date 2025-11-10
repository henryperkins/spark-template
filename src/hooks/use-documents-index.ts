import { useState, useEffect, useCallback } from 'react'
import { DocumentIndex } from '@/types'

export interface UseDocumentsIndexOptions {
  page?: number
  pageSize?: number
  q?: string
  source?: string
  status?: string
  azureIndexed?: boolean
}

export interface UseDocumentsIndexResult {
  documents: DocumentIndex[]
  loading: boolean
  error: Error | null
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
  refetch: () => Promise<void>
}

export function useDocumentsIndex(options: UseDocumentsIndexOptions = {}): UseDocumentsIndexResult {
  const [documents, setDocuments] = useState<DocumentIndex[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)
  const [pagination, setPagination] = useState({
    page: options.page || 1,
    pageSize: options.pageSize || 50,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  })

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (options.page) params.append('page', options.page.toString())
      if (options.pageSize) params.append('pageSize', options.pageSize.toString())
      if (options.q) params.append('q', options.q)
      if (options.source) params.append('source', options.source)
      if (options.status) params.append('status', options.status)
      if (options.azureIndexed !== undefined) params.append('azureIndexed', options.azureIndexed.toString())

      const response = await fetch(`/api/documents?${params.toString()}`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch documents' }))
        throw new Error(errorData.error || 'Failed to fetch documents')
      }

      const data = await response.json()
      
      setDocuments(data.documents || [])
      setPagination({
        page: data.pagination.page,
        pageSize: data.pagination.pageSize,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
        hasNextPage: data.pagination.hasNextPage,
        hasPrevPage: data.pagination.hasPrevPage
      })
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }, [options.page, options.pageSize, options.q, options.source, options.status, options.azureIndexed])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  return {
    documents,
    loading,
    error,
    pagination,
    refetch: fetchDocuments
  }
}