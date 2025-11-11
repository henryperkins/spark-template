import { StrictMode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { webVitals } from '@/lib/web-vitals'
import { initSentryClient, captureSentryException, withSentryScope } from '@/lib/services/sentry-client'
import { errorTracking } from '@/lib/services/error-tracker'

import "./main.css"

// Initialize Sentry (no-op if DSN not provided)
const { enabled: sentryEnabled } = initSentryClient()

// Initialize Web Vitals monitoring
webVitals.initialize()

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

const handleError = (error: Error, info: ErrorInfo) => {
  if (sentryEnabled) {
    withSentryScope(scope => {
      scope.setExtras({
        componentStack: info.componentStack ?? ''
      })
    })

    captureSentryException(error)
  }

  errorTracking.record(error, {
    type: 'runtime',
    agent: 'global-error-boundary',
    metadata: {
      componentStack: info.componentStack
    }
  })
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={handleError}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
)
