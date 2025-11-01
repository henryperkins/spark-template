interface AnalyticsConfig {
  endpoint?: string
  analyticsEndpoint?: string
}

type SendPayload = {
  event: string
  data: unknown
  timestamp: string
}

type ProcessLike = {
  env?: Record<string, string | undefined>
}

type GlobalProcessContainer = {
  process?: ProcessLike
}

const getExecutionMode = (): string | undefined => {
  try {
    return import.meta.env?.MODE
  } catch {
    // ignore and fallback to global process
  }

  const globalProcess = (globalThis as GlobalProcessContainer).process
  return globalProcess?.env?.NODE_ENV
}

const isDevEnvironment = (): boolean => getExecutionMode() !== 'production'

const computeEndpoint = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const sparkContainer = window as unknown as { spark?: AnalyticsConfig }
  const sparkEndpoint = sparkContainer.spark?.endpoint || sparkContainer.spark?.analyticsEndpoint

  if (sparkEndpoint) {
    return sparkEndpoint
  }

  if (import.meta?.env?.VITE_ANALYTICS_ENDPOINT) {
    return import.meta.env.VITE_ANALYTICS_ENDPOINT as string
  }

  return null
}

class AnalyticsBackend {
  private endpoint: string | null

  constructor() {
    this.endpoint = computeEndpoint()
  }

  private refreshEndpoint(): string | null {
    const resolved = computeEndpoint()

    if (resolved) {
      this.endpoint = resolved
      return resolved
    }

    return this.endpoint
  }

  async send(event: string, data: unknown): Promise<void> {
    const endpoint = this.refreshEndpoint()

    if (!endpoint) {
      if (isDevEnvironment()) {
        console.debug('[analytics-backend skipped]', event, data)
      }
      return
    }

    const payload: SendPayload = {
      event,
      data,
      timestamp: new Date().toISOString()
    }

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
        const ok = navigator.sendBeacon(endpoint, blob)

        if (ok) {
          return
        }
      }

      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
      })
    } catch (error) {
      if (isDevEnvironment()) {
        console.warn('Failed to send analytics event:', error)
      }
    }
  }
}

export const analyticsBackend = new AnalyticsBackend()
