import * as Sentry from '@sentry/react'

type InitResult = {
  enabled: boolean
}

let initialized = false
let enabled = false

function readEnv(key: string): string | undefined {
  try {
    const value = (import.meta as { env?: Record<string, unknown> })?.env?.[key]
    if (value !== undefined) {
      return String(value)
    }
  } catch {
    // ignore
  }

  try {
    const value = (globalThis as { process?: { env?: Record<string, unknown> } })?.process?.env?.[key]
    if (value !== undefined) {
      return String(value)
    }
  } catch {
    // ignore
  }

  return undefined
}

export function initSentryClient(): InitResult {
  if (initialized) {
    return { enabled }
  }

  const dsn = readEnv('VITE_SENTRY_DSN')
  if (!dsn) {
    initialized = true
    enabled = false
    return { enabled: false }
  }

  const release = readEnv('VITE_APP_VERSION')
  const environment = readEnv('VITE_APP_ENV') ?? readEnv('NODE_ENV') ?? readEnv('MODE')

  const tracesSampleRate = parseFloat(readEnv('VITE_SENTRY_TRACES_SAMPLE_RATE') ?? '0')

  const integrations: Array<ReturnType<typeof Sentry.browserTracingIntegration>> = []
  const normalizedSampleRate = Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0
  if (normalizedSampleRate > 0) {
    integrations.push(Sentry.browserTracingIntegration())
  }

  const initOptions: Parameters<typeof Sentry.init>[0] = {
    dsn,
    tracesSampleRate: normalizedSampleRate,
    integrations,
    beforeSend(event) {
      // Avoid sending events in local development without explicit opt-in
      if (import.meta.env?.DEV && readEnv('VITE_SENTRY_ENABLE_IN_DEV') !== 'true') {
        return null
      }
      return event
    }
  }

  if (release) {
    initOptions.release = release
  }
  if (environment) {
    initOptions.environment = environment
  }

  Sentry.init(initOptions)

  initialized = true
  enabled = true
  return { enabled }
}

export function captureSentryException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) {
    return
  }
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

export function withSentryScope<T>(callback: (scope: any) => T): T | undefined {
  if (!enabled) {
    return undefined
  }
  return Sentry.withScope(callback)
}

export const sentry = Sentry
