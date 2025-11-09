import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary"

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { webVitals } from '@/lib/web-vitals'

import "./main.css"

// Initialize Web Vitals monitoring
webVitals.initialize()

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
