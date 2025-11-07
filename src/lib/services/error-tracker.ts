/**
 * Error Tracking Service
 * Systematic error classification, aggregation, and analysis
 */

export type ErrorType = 'retrieval' | 'llm' | 'embedding' | 'cache' | 'network' | 'unknown'

export interface ErrorEvent {
  errorId: string
  type: ErrorType
  message: string
  stack?: string
  agent?: string
  query?: string
  code?: string
  status?: number
  requestId?: string
  timestamp: string
}

export interface ErrorMetrics {
  totalErrors: number
  errorRate: number // errors per hour
  byType: Record<ErrorType, number>
  recentErrors: ErrorEvent[]
  errorsByAgent: Record<string, number>
}

class ErrorTrackingService {
  private errors: ErrorEvent[] = []
  private maxErrorRetention = 500 // Keep last 500 errors in memory

  /**
   * Record an error with context
   */
  record(error: Error, context?: {
    type?: ErrorType
    agent?: string
    query?: string
    code?: string
    status?: number
    requestId?: string
  }): void {
    const errorEvent: ErrorEvent = {
      errorId: crypto.randomUUID(),
      type: context?.type || this.classifyError(error),
      message: error.message,
      stack: error.stack,
      agent: context?.agent,
      query: context?.query,
      code: context?.code,
      status: context?.status,
      requestId: context?.requestId,
      timestamp: new Date().toISOString()
    }

    this.errors.push(errorEvent)

    // Maintain retention limit
    if (this.errors.length > this.maxErrorRetention) {
      this.errors.shift()
    }

    // Log to console in dev mode
    if (import.meta.env.DEV) {
      console.error('[ErrorTracker]', {
        type: errorEvent.type,
        agent: errorEvent.agent,
        message: errorEvent.message,
        code: errorEvent.code
      })
    }
  }

  /**
   * Classify error based on message content
   */
  private classifyError(error: Error): ErrorType {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()

    if (msg.includes('fetch') || msg.includes('network') || name.includes('fetch')) {
      return 'network'
    }
    if (msg.includes('llm') || msg.includes('generate') || msg.includes('completion')) {
      return 'llm'
    }
    if (msg.includes('retrieval') || msg.includes('search') || msg.includes('query')) {
      return 'retrieval'
    }
    if (msg.includes('embedding') || msg.includes('vector')) {
      return 'embedding'
    }
    if (msg.includes('cache')) {
      return 'cache'
    }

    return 'unknown'
  }

  /**
   * Get all error metrics
   */
  getMetrics(): ErrorMetrics {
    const now = Date.now()
    const oneHourAgo = now - 3600000

    // Count errors in last hour for error rate
    const recentErrors = this.errors.filter(e =>
      new Date(e.timestamp).getTime() > oneHourAgo
    )

    // Count by type
    const byType: Record<ErrorType, number> = {
      retrieval: 0,
      llm: 0,
      embedding: 0,
      cache: 0,
      network: 0,
      unknown: 0
    }

    this.errors.forEach(error => {
      byType[error.type] = (byType[error.type] || 0) + 1
    })

    // Count by agent
    const errorsByAgent: Record<string, number> = {}
    this.errors.forEach(error => {
      if (error.agent) {
        errorsByAgent[error.agent] = (errorsByAgent[error.agent] || 0) + 1
      }
    })

    return {
      totalErrors: this.errors.length,
      errorRate: recentErrors.length,
      byType,
      recentErrors: this.errors.slice(-10).reverse(), // Last 10, newest first
      errorsByAgent
    }
  }

  /**
   * Get errors for a specific time window
   */
  getErrorsInWindow(hours: number = 24): ErrorEvent[] {
    const cutoff = Date.now() - (hours * 3600000)
    return this.errors.filter(e =>
      new Date(e.timestamp).getTime() > cutoff
    )
  }

  /**
   * Get errors by type
   */
  getErrorsByType(type: ErrorType): ErrorEvent[] {
    return this.errors.filter(e => e.type === type)
  }

  /**
   * Get errors by agent
   */
  getErrorsByAgent(agent: string): ErrorEvent[] {
    return this.errors.filter(e => e.agent === agent)
  }

  /**
   * Check if error rate is above threshold
   */
  isErrorRateHigh(threshold: number = 5): boolean {
    const metrics = this.getMetrics()
    return metrics.errorRate > threshold
  }

  /**
   * Get error rate trend (comparing last hour to previous hour)
   */
  getErrorRateTrend(): 'increasing' | 'decreasing' | 'stable' {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    const twoHoursAgo = now - 7200000

    const lastHourErrors = this.errors.filter(e => {
      const time = new Date(e.timestamp).getTime()
      return time > oneHourAgo && time <= now
    }).length

    const previousHourErrors = this.errors.filter(e => {
      const time = new Date(e.timestamp).getTime()
      return time > twoHoursAgo && time <= oneHourAgo
    }).length

    if (lastHourErrors > previousHourErrors * 1.2) {
      return 'increasing'
    } else if (lastHourErrors < previousHourErrors * 0.8) {
      return 'decreasing'
    }
    return 'stable'
  }

  /**
   * Clear all errors (for testing or cleanup)
   */
  clearErrors(): void {
    this.errors = []
  }

  /**
   * Get all errors
   */
  getAllErrors(): ErrorEvent[] {
    return [...this.errors]
  }
}

export const errorTracking = new ErrorTrackingService()
