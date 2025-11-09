import { useMemo } from 'react'

export interface VirtualizedDocumentsOptions {
  windowSize?: number
}

export interface VirtualizedDocumentsResult<T> {
  visibleDocuments: T[]
  hasMore: boolean
  totalCount: number
  windowStart: number
  windowEnd: number
}

export function useVirtualizedDocuments<T>(
  documents: T[],
  options: VirtualizedDocumentsOptions = {}
): VirtualizedDocumentsResult<T> {
  const { windowSize = 50 } = options

  // Calculate visible window - show most recent documents
  const visibleDocuments = useMemo(() => {
    if (documents.length <= windowSize) {
      return documents
    }

    // For document lists, show the most recent documents
    const nextStart = Math.max(0, documents.length - windowSize)
    return documents.slice(nextStart)
  }, [documents, windowSize])

  const totalCount = documents.length
  const hasMore = documents.length > visibleDocuments.length

  // Calculate window start based on the visible documents
  const windowStart = documents.length <= windowSize
    ? 0
    : Math.max(0, documents.length - windowSize)

  const windowEnd = Math.min(windowStart + windowSize, totalCount)

  return {
    visibleDocuments,
    hasMore,
    totalCount,
    windowStart,
    windowEnd
  }
}