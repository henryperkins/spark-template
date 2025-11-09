import { useState, useMemo, useCallback } from 'react'

export interface VirtualizedWorkflowOptions {
  windowSize?: number
  expandedWindowSize?: number
  enableReducedMotionForLargeWorkflows?: boolean
}

export interface VirtualizedWorkflowResult<T = unknown> {
  visibleSteps: T[]
  expandedSteps: Set<number>
  toggleStep: (index: number) => void
  hasMore: boolean
  totalCount: number
  windowStart: number
  windowEnd: number
  isExpanded: (index: number) => boolean
  shouldReduceMotion: boolean
}

export function useVirtualizedWorkflow<T = unknown>(
  steps: T[],
  options: VirtualizedWorkflowOptions = {}
): VirtualizedWorkflowResult<T> {
  const {
    windowSize = 50,
    expandedWindowSize = 20,
    enableReducedMotionForLargeWorkflows = true
  } = options

  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  // Calculate if we should reduce motion for performance
  const shouldReduceMotion = useMemo(() => {
    if (!enableReducedMotionForLargeWorkflows) return false
    return steps.length > 100 // Reduce motion for workflows with 100+ steps
  }, [steps.length, enableReducedMotionForLargeWorkflows])

  // Calculate window start - derived from steps and windowSize
  const windowStart = useMemo(() => {
    if (steps.length <= windowSize) {
      return 0
    }
    // For live workflows, show the most recent steps
    return Math.max(0, steps.length - windowSize)
  }, [steps.length, windowSize])

  // Calculate visible window
  const visibleSteps = useMemo(() => {
    if (steps.length <= windowSize) {
      return steps
    }
    return steps.slice(windowStart)
  }, [steps, windowSize, windowStart])

  const hasMore = steps.length > visibleSteps.length
  const totalCount = steps.length
  const windowEnd = Math.min(windowStart + windowSize, totalCount)

  const toggleStep = useCallback((index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      
      // Convert visible index to actual index
      const actualIndex = windowStart + index
      
      if (next.has(actualIndex)) {
        next.delete(actualIndex)
      } else {
        // Limit expanded steps for performance
        if (next.size >= expandedWindowSize) {
          const iterator = next.values().next()
          if (!iterator.done) {
            next.delete(iterator.value)
          }
        }
        next.add(actualIndex)
      }
      
      return next
    })
  }, [windowStart, expandedWindowSize])

  const isExpanded = useCallback((index: number) => {
    const actualIndex = windowStart + index
    return expandedSteps.has(actualIndex)
  }, [expandedSteps, windowStart])

  return {
    visibleSteps,
    expandedSteps,
    toggleStep,
    hasMore,
    totalCount,
    windowStart,
    windowEnd,
    isExpanded,
    shouldReduceMotion
  }
}
