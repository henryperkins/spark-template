import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDocumentsIndex } from '@/hooks/use-documents-index'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useDocumentsIndex', () => {
  const mockDocuments = [
    {
      id: '1',
      name: 'Test Document 1',
      size: 1024,
      uploadedAt: new Date().toISOString(),
      type: 'text/plain',
      source: 'upload',
      processingStatus: 'completed',
      azureIndexed: true,
      chunkCount: 5
    },
    {
      id: '2',
      name: 'Test Document 2',
      size: 2048,
      uploadedAt: new Date().toISOString(),
      type: 'text/plain',
      source: 'github',
      processingStatus: 'processing',
      azureIndexed: false,
      chunkCount: 3
    }
  ]

  const mockResponse = {
    documents: mockDocuments,
    pagination: {
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    })
  })

  it('fetches documents on mount', async () => {
    const { result } = renderHook(() => useDocumentsIndex())

    expect(result.current.loading).toBe(true)
    expect(result.current.documents).toEqual([])

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.documents).toEqual(mockDocuments)
    expect(mockFetch).toHaveBeenCalledWith('/api/documents?')
  })

  it('applies query parameters correctly', async () => {
    const { result } = renderHook(() => useDocumentsIndex({
      page: 2,
      pageSize: 10,
      q: 'test',
      source: 'upload',
      status: 'completed',
      azureIndexed: true
    }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/documents?page=2&pageSize=10&q=test&source=upload&status=completed&azureIndexed=true'
    )
  })

  it('handles search query changes', async () => {
    const { result, rerender } = renderHook(
      ({ q }) => useDocumentsIndex({ q }),
      { initialProps: { q: 'initial' } }
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/documents?q=initial')

    rerender({ q: 'updated' })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/documents?q=updated')
    })
  })

  it('handles fetch errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Failed to fetch documents' })
    })

    const { result } = renderHook(() => useDocumentsIndex())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toEqual(new Error('Failed to fetch documents'))
    expect(result.current.documents).toEqual([])
  })

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useDocumentsIndex())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toEqual(new Error('Network error'))
    expect(result.current.documents).toEqual([])
  })

  it('provides refetch function', async () => {
    const { result } = renderHook(() => useDocumentsIndex())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    mockFetch.mockClear()

    await result.current.refetch()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/documents?')
  })

  it('returns correct pagination data', async () => {
    const { result } = renderHook(() => useDocumentsIndex())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false
    })
  })

  it('handles empty response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        documents: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        }
      })
    })

    const { result } = renderHook(() => useDocumentsIndex())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.documents).toEqual([])
    expect(result.current.pagination.total).toBe(0)
  })
})