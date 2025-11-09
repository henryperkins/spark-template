/**
 * Lightweight telemetry emitter for the browser.
 * Posts events to a Cloudflare Worker endpoint when configured,
 * falls back to console.debug in development.
 */
export async function track(event: string, payload: unknown): Promise<void> {
  const configured = (import.meta as any)?.env?.VITE_ANALYTICS_ENDPOINT
  const defaultPath = '/api/telemetry'
  let endpoint = configured || defaultPath

  // Ensure absolute URL for Node/undici and non-browser environments
  if (endpoint.startsWith('/')) {
    try {
      const origin =
        (typeof window !== 'undefined' && (window as any).location?.origin) ||
        'http://localhost:5000'
      endpoint = new URL(endpoint, origin).toString()
    } catch {
      // leave as-is; fetch may still resolve in browser contexts
    }
  }

  try {
    if (typeof navigator !== 'undefined' && typeof (navigator as any).sendBeacon === 'function') {
      const blob = new Blob(
        [JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() })],
        { type: 'application/json' }
      )
      const ok = (navigator as any).sendBeacon(endpoint, blob)
      if (ok) return
    }
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() }),
      keepalive: true,
    })
  } catch (error) {
    if ((import.meta as any)?.env?.MODE !== 'production') {
      console.debug('[telemetry:fallback]', event, payload, error)
    }
  }
}

