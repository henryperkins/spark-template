import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

export type LlmCompletionPayload =
  | string
  | Array<{ role: string; content: string }>

export interface LlmProvider {
  complete: (prompt: LlmCompletionPayload, options?: { model?: string; json?: boolean }) => Promise<string>
}

export interface TelemetrySink {
  track: (event: string, payload: unknown) => Promise<void>
}

function createWorkerLlmProvider(): LlmProvider | null {
  const base =
    (import.meta as any)?.env?.VITE_LLM_ENDPOINT ||
    '/api/llm'

  // Always expose the provider; the Worker handler will decide how to respond.
  // If the route is missing, calls will reject and the caller can handle the error.
  return {
    async complete(prompt: LlmCompletionPayload, options?: { model?: string; json?: boolean }) {
      const body = {
        prompt,
        model: options?.model,
        json: options?.json === true,
      }
      try {
        const resp = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!resp.ok) {
          // Fallback to deterministic stub if route missing in Vite dev
          if (resp.status === 404) {
            const text = typeof body.prompt === 'string'
              ? body.prompt
              : (body.prompt as Array<{ role: string; content: string }>).map(m => m.content).join('\n')
            if (body.json) {
              return JSON.stringify({
                summary: text.slice(0, 120),
                note: 'Local dev stub (Worker /api/llm not running)',
                model: body.model ?? 'worker-stub',
              })
            }
            const head = text.length > 300 ? text.slice(0, 300) + '…' : text
            return `Stubbed local response (model: ${body.model ?? 'worker-stub'}): ${head}`
          }
          const text = await resp.text().catch(() => String(resp.status))
          throw new Error(`LLM worker error (${resp.status}): ${text}`)
        }
        // Handler returns { text: string }
        const data = await resp.json() as { text?: string }
        if (!data?.text) {
          throw new Error('LLM worker returned empty response')
        }
        return data.text
      } catch {
        // Network error – dev fallback
        const text = typeof body.prompt === 'string'
          ? body.prompt
          : (body.prompt as Array<{ role: string; content: string }>).map(m => m.content).join('\n')
        if (body.json) {
          return JSON.stringify({
            summary: text.slice(0, 120),
            note: 'Local dev stub (Worker /api/llm unreachable)',
            model: body.model ?? 'worker-stub',
          })
        }
        const head = text.length > 300 ? text.slice(0, 300) + '…' : text
        return `Stubbed local response (model: ${body.model ?? 'worker-stub'}): ${head}`
      }
    },
  }
}

async function createTelemetrySink(): Promise<TelemetrySink> {
  const endpoint =
    (import.meta as any)?.env?.VITE_ANALYTICS_ENDPOINT ||
    '/api/telemetry'

  return {
    async track(event: string, payload: unknown) {
      try {
        // Prefer beacon when available
        if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
          const blob = new Blob([JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() })], {
            type: 'application/json',
          })
          const ok = (navigator as any).sendBeacon(endpoint, blob)
          if (ok) return
        }
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() }),
          keepalive: true,
        })
      } catch (err) {
        if ((import.meta as any)?.env?.MODE !== 'production') {
          console.debug('[telemetry:fallback]', event, payload, err)
        }
      }
    },
  }
}

export interface RuntimeContext {
  llm: LlmProvider | null
  kv: CloudflareKVAdapter | null
  telemetry: TelemetrySink | null
}

const kv = createCloudflareKV()
const llm = createWorkerLlmProvider()
const telemetryPromise = createTelemetrySink().catch(() => null)

export const runtime: RuntimeContext = {
  llm,
  kv,
  telemetry: null, // will be set once the promise resolves; keep immutable shape
}

// Initialize telemetry asynchronously to avoid blocking module load
void telemetryPromise.then((sink) => {
  if (sink) {
    ;(runtime as any).telemetry = sink
  }
})
