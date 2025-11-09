 // <reference types="@cloudflare/workers-types" />
 /**
  * Cloudflare Worker entry point
  * Serves the React SPA and provides API endpoints for KV operations
  */

 // Local fallbacks for types to avoid editor/tsserver resolution issues
 // (build still succeeds with official Workers types in production)
 type KVNamespaceListOptions = {
   prefix?: string
   cursor?: string
   limit?: number
 }

// R2Object interface for type safety
interface R2ObjectLike {
  key: string
  size: number
  uploaded: string | Date | unknown
}

 // Fallback CF types if Workers types aren't available in local tsserver
 // (Build uses official @cloudflare/workers-types via triple-slash reference)
 interface KVNamespace {
   get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown>
   put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<void>
   delete(key: string): Promise<void>
   list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: Array<{ name: string }>; cursor?: string; list_complete?: boolean }>
 }
 interface R2Bucket {
   get(key: string): Promise<{ text(): Promise<string>; size: number } | null>
   list(options?: { limit?: number }): Promise<{ objects: Array<R2ObjectLike>; truncated?: boolean }>
 }
 interface Fetcher {
   fetch(request: Request): Promise<Response>
 }
 type ExecutionContext = unknown

export interface Env {
  RAG_KV: KVNamespace
  LOGS: R2Bucket // R2 bucket for Logpush logs
  ASSETS: Fetcher
  VITE_CLOUDFLARE_API_TOKEN?: string
  VITE_AZURE_OPENAI_KEY?: string
  VITE_AZURE_SEARCH_KEY?: string
  LOGS_API_KEY?: string
  KV_API_KEY?: string
  AZURE_API_KEY?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_DEFAULT_MODEL?: string
  ALLOW_CLIENT_MODEL?: string
  // Optional legacy KV for one-shot migration
  LEGACY_KV?: KVNamespace
  // Secret key to authorize migration
  MIGRATION_KEY?: string
  // Azure Search (server-side)
  AZURE_SEARCH_ENDPOINT?: string
  AZURE_SEARCH_KEY?: string
}

// Structured log types
interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  event: string
  method?: string
  path?: string
  key?: string
  statusCode?: number
  duration?: number
  error?: string
  metadata?: Record<string, unknown>
}

// Helper function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// Helper function to create structured logs
function logStructured(entry: Omit<LogEntry, 'timestamp'>): void {
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  console.log(JSON.stringify(logEntry))
}

// CORS configuration
const ALLOWED_ORIGINS = [
  // Production
  'https://paradigmfind.com',
  'https://www.paradigmfind.com',
  // Local dev (Vite + Wrangler)
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
]

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin') || ''
  // Allow non-CORS requests (no Origin header) to proceed
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(origin)
}

function corsHeadersFor(
  request: Request,
  options?: { allowAuth?: boolean; methods?: string[] }
): Record<string, string> {
  const origin = request.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.includes(origin)
  const methods = options?.methods ?? ['GET', 'POST', 'DELETE', 'OPTIONS']
  const allowedHeaders = ['Content-Type']
  if (options?.allowAuth) allowedHeaders.push('Authorization')

  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': methods.join(', '),
    'Access-Control-Allow-Headers': allowedHeaders.join(', '),
    'Access-Control-Max-Age': '86400',
  }
}

const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(request: Request, limit: number = 100, windowMs: number = 60000): boolean {
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown'
  const now = Date.now()

  // Clean expired windows
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetTime < now) {
      rateLimitStore.delete(key)
    }
  }

  const current = rateLimitStore.get(clientIP)
  if (!current || current.resetTime < now) {
    rateLimitStore.set(clientIP, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (current.count >= limit) {
    return false
  }

  current.count++
  return true
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const startTime = Date.now()

    try {
      // Health check endpoint
      if (url.pathname === '/api/health') {
        const healthCheck = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            kv: !!env.RAG_KV,
            logs: !!env.LOGS,
            assets: !!env.ASSETS
          }
        }
        return Response.json(healthCheck, {
          headers: { 'Cache-Control': 'no-store', ...corsHeadersFor(request, { methods: ['GET', 'OPTIONS'] }) }
        })
      }

      // Edge LLM proxy endpoint
      if (url.pathname.startsWith('/api/llm')) {
        return handleLLMRequest(request, env)
      }

      // Telemetry endpoint
      if (url.pathname.startsWith('/api/telemetry')) {
        return handleTelemetryRequest(request, env)
      }

      // API endpoint for KV operations
      if (url.pathname.startsWith('/api/kv')) {
        const response = await handleKVRequest(request, env)
        const duration = Date.now() - startTime

        logStructured({
          level: 'info',
          event: 'kv_api_request',
          method: request.method,
          path: url.pathname,
          statusCode: response.status,
          duration,
        })

        return response
      }

      // Chunked upload endpoint
      if (url.pathname === '/api/upload-chunk') {
        return handleUploadChunkRequest(request, env)
      }

      // Chunk assembly endpoint
      if (url.pathname === '/api/upload-complete') {
        return handleUploadCompleteRequest(request, env)
      }

      // API endpoint for Azure Search proxy (avoids CORS)
      if (url.pathname.startsWith('/api/azure-search')) {
        return handleAzureSearchRequest(request, env)
      }


      // API endpoint for accessing logs
      if (url.pathname.startsWith('/api/logs')) {
        return handleLogsRequest(request, env)
      }

      // One-shot KV migration (legacy -> RAG_KV)
      if (url.pathname.startsWith('/api/migrate')) {
        return handleMigrationRequest(request, env)
      }

      // Serve static assets (React app)
      const response = await (env.ASSETS as any).fetch(request)

      // Only log non-asset requests to reduce noise
      if (!url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
        logStructured({
          level: 'debug',
          event: 'asset_request',
          method: request.method,
          path: url.pathname,
          statusCode: response.status,
          duration: Date.now() - startTime,
        })
      }

      return response
    } catch (error: unknown) {
      const duration = Date.now() - startTime

      logStructured({
        level: 'error',
        event: 'request_error',
        method: request.method,
        path: url.pathname,
        error: getErrorMessage(error),
        duration,
      })

      return new Response('Internal Server Error', { status: 500 })
    }
  },
}

/**
 * Edge LLM proxy
 * In absence of a configured upstream, returns a deterministic stub response.
 */
async function handleLLMRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = corsHeadersFor(request, { methods: ['POST', 'OPTIONS'] })

  // Preflight
  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // CORS enforcement for browser requests
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  try {
    const body = (await request.json()) as {
      prompt: string | Array<{ role: string; content: string }>
      model?: string
      json?: boolean
    }
    let promptText: string
    if (typeof body.prompt === 'string') {
      promptText = body.prompt
    } else if (Array.isArray(body.prompt)) {
      promptText = body.prompt.map((m) => m.content).join('\n')
    } else {
      return new Response('Invalid prompt', { status: 400, headers: corsHeaders })
    }

    // If OPENAI_API_KEY is configured, forward to OpenAI Chat Completions
    const openaiKey = env.OPENAI_API_KEY

    if (openaiKey) {
      const baseUrl = (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL.trim()) || 'https://api.openai.com/v1'
      const allowClientModel = (env.ALLOW_CLIENT_MODEL || '').toLowerCase() === 'true'
      const model =
        (allowClientModel && body.model) ||
        env.OPENAI_DEFAULT_MODEL ||
        'gpt-4o-mini'

      const messages =
        typeof body.prompt === 'string'
          ? [{ role: 'user', content: body.prompt }]
          : body.prompt

      const payload: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.2,
      }
      if (body.json) {
        payload.response_format = { type: 'json_object' }
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText)
        return new Response(`Upstream OpenAI error (${resp.status}): ${text}`, {
          status: 502,
          headers: corsHeaders,
        })
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = data?.choices?.[0]?.message?.content || ''
      return Response.json({ text }, { headers: corsHeaders })
    }

    // Deterministic stub to ensure local/dev behavior without upstream config.
    if (body.json) {
      // Emit a schema-conforming stub for JSON-mode calls
      const stubDecision = {
        strategy: 'semantic',
        chunkSize: 1000,
        overlap: 100,
        reasoning: 'Stubbed JSON decision for local/dev; configure OPENAI_API_KEY for real analysis.'
      }
      return Response.json({ text: JSON.stringify(stubDecision) }, { headers: corsHeaders })
    }
    const text =
      `Stubbed worker response (model: ${body.model ?? 'worker-stub'}): ` +
      (promptText.length > 300 ? promptText.slice(0, 300) + '…' : promptText)
    return Response.json({ text }, { headers: corsHeaders })
  } catch (error) {
    return new Response((error as Error)?.message || 'Bad Request', { status: 400, headers: corsHeaders })
  }
}

/**
 * Telemetry ingestion endpoint
 */
async function handleTelemetryRequest(request: Request, _env: Env): Promise<Response> {
  const corsHeaders = corsHeadersFor(request, { methods: ['POST', 'OPTIONS'] })

  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  try {
    const { event, data, timestamp } = (await request.json().catch(() => ({}))) as {
      event?: string
      data?: unknown
      timestamp?: string
    }
    if (!event) {
      return new Response('Missing event', { status: 400, headers: corsHeaders })
    }
    logStructured({
      level: 'info',
      event: 'client_telemetry',
      metadata: { event, payload: data, t: timestamp ?? new Date().toISOString() },
    })
    return new Response(null, { status: 204, headers: corsHeaders })
  } catch (error) {
    return new Response((error as Error)?.message || 'Bad Request', { status: 400, headers: corsHeaders })
  }
}

/**
 * Handle KV API requests
 * Provides REST API for client-side KV operations
 */
async function handleKVRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/kv', '')
  const rawKey = path.startsWith('/') ? path.slice(1) : path
  const key = rawKey ? decodeURIComponent(rawKey) : ''

  // CORS headers for restricted origins
  const corsHeaders = corsHeadersFor(request, {
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowAuth: true,
  })

  // Handle preflight
  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  // Rate limiting
  if (!checkRateLimit(request)) {
    return new Response('Rate limit exceeded', { status: 429, headers: corsHeaders })
  }

  // Enforce origin on CORS requests
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  // Health endpoint - check KV configuration without requiring auth
  if (request.method === 'GET' && key === 'health') {
    const hasKVApiKey = Boolean(env.KV_API_KEY)
    const hasKVBinding = Boolean(env.RAG_KV)

    let canAccessKV = false
    let kvError: string | null = null

    if (hasKVBinding) {
      try {
        // Test KV access with a simple list operation
        await (env.RAG_KV as any).list({ limit: 1 })
        canAccessKV = true
      } catch (error) {
        kvError = (error as Error)?.message || 'Unknown KV error'
      }
    }

    const isHealthy = hasKVApiKey && hasKVBinding && canAccessKV

    logStructured({
      level: isHealthy ? 'info' : 'warn',
      event: 'kv_health_check',
      metadata: {
        ok: isHealthy,
        hasKVApiKey,
        hasKVBinding,
        canAccessKV,
        kvError,
      },
    })

    return Response.json(
      {
        ok: isHealthy,
        mode: 'worker',
        details: {
          kvApiKeyConfigured: hasKVApiKey,
          kvBindingPresent: hasKVBinding,
          kvAccessible: canAccessKV,
          error: kvError,
        },
      },
      {
        status: isHealthy ? 200 : 503,
        headers: corsHeaders
      }
    )
  }

  const expectedApiKey = env.KV_API_KEY
  if (!expectedApiKey) {
    logStructured({
      level: 'error',
      event: 'kv_api_key_missing',
    })
    return new Response('KV API key not configured', { status: 503, headers: corsHeaders })
  }

  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()
  if (!token || token !== expectedApiKey) {
    logStructured({
      level: 'warn',
      event: 'kv_auth_failed',
      method: request.method,
      path: url.pathname,
    })
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  try {
    switch (request.method) {
      case 'GET': {
        if (!key) {
          // List all keys
          const cursorParam = url.searchParams.get('cursor') ?? undefined
          const prefixParam = url.searchParams.get('prefix') ?? undefined
          const limitParam = url.searchParams.get('limit')
          const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined
          const safeLimit =
            parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0
              ? Math.min(parsedLimit, 1000)
              : undefined

          const listOptions: { cursor?: string; prefix?: string; limit?: number } = {}
          if (cursorParam) listOptions.cursor = cursorParam
          if (prefixParam) listOptions.prefix = prefixParam
          if (safeLimit) listOptions.limit = safeLimit

          const listed = await (env.RAG_KV as any).list(listOptions as KVNamespaceListOptions)
          logStructured({
            level: 'info',
            event: 'kv_list_keys',
            metadata: {
              count: (listed as any).keys.length,
              cursorSupplied: Boolean(cursorParam),
              nextCursor: (listed as any).cursor ?? null,
              listComplete: (listed as any).list_complete ?? false,
            },
          })
// Edge cache lookup for single-key GETs
if (!url.searchParams.get('nocache') && key) {
  const cache = caches.default
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) {
    logStructured({
      level: 'info',
      event: 'kv_cache_hit',
      key,
    })
    return cachedResponse
  }
}
          return Response.json(
            {
              keys: (listed as any).keys.map((k: { name: string }) => k.name),
              cursor: (listed as any).cursor ?? null,
              list_complete: (listed as any).list_complete ?? false,
            },
            { headers: corsHeaders }
          )
        }

        // Edge cache lookup for single-key GETs
        if (!url.searchParams.get('nocache') && key) {
          const cache = caches.default
          const cacheKey = new Request(url.toString(), { method: 'GET' })
          const cachedResponse = await cache.match(cacheKey)
          if (cachedResponse) {
            logStructured({
              level: 'info',
              event: 'kv_cache_hit',
              key,
            })
            return cachedResponse
          }
        }

        // Get single key with defensive JSON parsing
        let value: any = null
        try {
          value = await (env.RAG_KV as any).get(key, { type: 'json' })
        } catch (parseError) {
          // JSON parse error: value is corrupted or not valid JSON
          logStructured({
            level: 'warn',
            event: 'kv_invalid_json',
            key,
            metadata: { error: (parseError as Error)?.message || 'Parse error' },
          })
          // Treat invalid JSON as missing/unconfigured
          value = null
        }

        if (value === null) {
          // Known expected keys that may not be configured yet
          // Return 200 with structured response instead of 404 to reduce console noise
          const knownKeys = [
            'azure-config',
            'azure-status',
            'azure-saved-configs',
            'rag-documents',
            'llm-usage-metrics',
            'cache-metrics',
            'query-history',
            'alert-history',
            'alert-config',
            'active-namespace',
            'token-budget',
          ]

          if (knownKeys.includes(key)) {
            logStructured({
              level: 'info',
              event: 'kv_key_not_configured',
              key,
            })
            return Response.json(
              { configured: false, key, message: 'Key not yet configured' },
              { headers: corsHeaders }
            )
          }

          // Unknown keys: return structured 404
          logStructured({
            level: 'info',
            event: 'kv_key_not_found',
            key,
          })
          return Response.json(
            { error: 'Not found', key, message: 'Key does not exist' },
            { status: 404, headers: corsHeaders }
          )
        }

        logStructured({
          level: 'info',
          event: 'kv_get_key',
          key,
        })

        const response = Response.json(value, { headers: corsHeaders })

        // Cache successful GET response for 5 minutes unless nocache is set
        if (!url.searchParams.get('nocache') && key) {
          try {
            const cache = caches.default
            const cacheKey = new Request(url.toString(), { method: 'GET' })
            const cacheableResponse = response.clone()
            cacheableResponse.headers.set('Cache-Control', 'public, max-age=300')
            await cache.put(cacheKey, cacheableResponse)
          } catch {
            // ignore cache put errors
          }
        }

        return response
      }

      case 'POST': {
        if (!key) {
          return new Response('Key required', { status: 400, headers: corsHeaders })
        }

        const body = await request.text()
        await (env.RAG_KV as any).put(key, body)

        logStructured({
          level: 'info',
          event: 'kv_put_key',
          key,
          metadata: { size: body.length },
        })

        return new Response(null, { status: 200, headers: corsHeaders })
      }

      case 'DELETE': {
        if (!key) {
          return new Response('Key required', { status: 400, headers: corsHeaders })
        }

        await (env.RAG_KV as any).delete(key)

        logStructured({
          level: 'info',
          event: 'kv_delete_key',
          key,
        })

        return new Response(null, { status: 204, headers: corsHeaders })
      }

      default:
        return new Response('Method not allowed', { status: 405, headers: corsHeaders })
    }
  } catch (error: unknown) {
    logStructured({
      level: 'error',
      event: 'kv_operation_error',
      method: request.method,
      key,
      error: getErrorMessage(error),
    })

    return new Response(getErrorMessage(error) || 'Internal server error', {
      status: 500,
      headers: corsHeaders,
    })
  }
}

/**
 * Handle Azure Search proxy requests (server-side fetch to avoid browser CORS)
 */
async function handleAzureSearchRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const corsHeaders = corsHeadersFor(request, { methods: ['GET', 'POST', 'OPTIONS'], allowAuth: true })

  // Preflight
  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  // Enforce CORS allowlist
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  // Optional bearer enforcement (use AZURE_API_KEY if configured)
  const expectedBearer = env.AZURE_API_KEY as string | undefined
  if (expectedBearer) {
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()
    if (!token || token !== expectedBearer) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }
  }

  // Resolve Azure Search endpoint and key (prefer server-side names, then VITE_ fallbacks)
  const rawEndpoint =
    env.AZURE_SEARCH_ENDPOINT ||
    (env as unknown).VITE_AZURE_SEARCH_ENDPOINT
  const endpoint = (rawEndpoint || '').replace(/\/+$/, '')
  const apiKey =
    env.AZURE_SEARCH_KEY ||
    (env as unknown).VITE_AZURE_SEARCH_KEY

  if (!endpoint || !apiKey) {
    return new Response('Azure Search not configured', { status: 503, headers: corsHeaders })
  }

  try {
    // POST /api/azure-search/search
    if (request.method === 'POST' && url.pathname === '/api/azure-search/search') {
      const body = (await request.json()) as {
        indexName: string
        apiVersion?: string
        request: Record<string, unknown>
      }
      if (!body?.indexName || !body?.request) {
        return new Response('indexName and request required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = body.apiVersion || '2025-09-01'
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(body.indexName)}/docs/search?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body.request),
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // POST /api/azure-search/index  (documents index endpoint)
    if (request.method === 'POST' && url.pathname === '/api/azure-search/index') {
      const body = (await request.json()) as {
        indexName: string
        apiVersion?: string
        batch: Record<string, unknown>
      }
      if (!body?.indexName || !body?.batch) {
        return new Response('indexName and batch required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = body.apiVersion || '2025-09-01'
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(body.indexName)}/docs/index?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body.batch),
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // POST /api/azure-search/create-index
    if (request.method === 'POST' && url.pathname === '/api/azure-search/create-index') {
      const body = (await request.json()) as {
        indexName?: string
        apiVersion?: string
        schema: Record<string, unknown>
        allowIndexDowntime?: boolean
      }
      if (!body?.schema || !body?.indexName) {
        return new Response('indexName and schema required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = body.apiVersion || '2025-09-01'
      const allowIndexDowntime =
        body.allowIndexDowntime === undefined ? true : Boolean(body.allowIndexDowntime)
      const downtimeParam = allowIndexDowntime ? '&allowIndexDowntime=true' : ''
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(body.indexName)}?api-version=${encodeURIComponent(
        apiVersion,
      )}${downtimeParam}`
      const resp = await fetch(forwardUrl, {
        method: 'PUT',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body.schema),
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/azure-search/indexes/:index (metadata)
    if (request.method === 'GET' && url.pathname.startsWith('/api/azure-search/indexes/')) {
      const parts = url.pathname.split('/')
      const indexName = decodeURIComponent(parts[parts.length - 1] || '')
      if (!indexName) {
        return new Response('index required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = url.searchParams.get('apiVersion') || '2025-09-01'
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(indexName)}?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'GET',
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // POST /api/azure-search/analyze (analyzer testing)
    if (request.method === 'POST' && url.pathname === '/api/azure-search/analyze') {
      const body = (await request.json()) as {
        indexName: string
        apiVersion?: string
        request: Record<string, unknown>
      }
      if (!body?.indexName || !body?.request) {
        return new Response('indexName and request required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = body.apiVersion || '2025-09-01'
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(body.indexName)}/analyze?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body.request),
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/azure-search/indexes/:index/stats (index statistics)
    if (request.method === 'GET' && url.pathname.match(/^\/api\/azure-search\/indexes\/[^/]+\/stats$/)) {
      const parts = url.pathname.split('/')
      const indexName = decodeURIComponent(parts[parts.length - 2] || '')
      if (!indexName) {
        return new Response('index required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = url.searchParams.get('apiVersion') || '2025-09-01'
      const forwardUrl = `${endpoint}/indexes/${encodeURIComponent(indexName)}/stats?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'GET',
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      })
      const text = await resp.text()
      return new Response(text, {
        status: resp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logStructured({
      level: 'error',
      event: 'azure_search_proxy_error',
      method: request.method,
      path: url.pathname,
      error: message,
    })
    return new Response(message || 'Internal server error', { status: 500, headers: corsHeaders })
  }
}

/**
 * Handle Logs API requests
 * Provides programmatic access to Logpush logs stored in R2
 */
/**
 * Handle chunked upload requests for large files.
 *
 * Lifecycle:
 * 1. Client uploads chunks via POST /api/upload-chunk (this endpoint)
 * 2. Chunks are stored in KV with 1-hour TTL to handle incomplete uploads
 * 3. Client calls POST /api/upload-complete to trigger assembly
 * 4. Assembly endpoint (handleUploadCompleteRequest) merges chunks and cleans up KV keys
 *
 * Only reachable when runtime.isCloudflareWorkers() is true (gated in DocumentUpload.tsx).
 */
async function handleUploadChunkRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = corsHeadersFor(request, { methods: ['POST', 'OPTIONS'] })

  // Preflight
  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Enforce origin on CORS requests
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  try {
    const form = await request.formData()
    const chunk = form.get('chunk') as File | null
    const documentId = String(form.get('documentId') || '')
    const chunkIndex = Number.parseInt(String(form.get('chunkIndex') || ''), 10)

    if (!chunk || !documentId || Number.isNaN(chunkIndex)) {
      return new Response('Invalid form data', { status: 400, headers: corsHeaders })
    }

    const buf = await chunk.arrayBuffer()
    const key = `upload-chunk:${documentId}:${chunkIndex.toString().padStart(6, '0')}`

    // Store raw bytes with TTL so incomplete uploads eventually expire
    await (env.RAG_KV as any).put(key, buf as any, { expirationTtl: 3600 })

    logStructured({
      level: 'info',
      event: 'upload_chunk_saved',
      metadata: { documentId, chunkIndex, size: buf.byteLength },
    })

    return new Response(null, { status: 204, headers: corsHeaders })
  } catch (error: unknown) {
    return new Response(getErrorMessage(error) || 'Bad Request', { status: 400, headers: corsHeaders })
  }
}

async function handleUploadCompleteRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = corsHeadersFor(request, { methods: ['POST', 'OPTIONS'] })

  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  try {
    const { documentId, fileName, fileType, totalChunks } = (await request.json()) as {
      documentId?: string
      fileName?: string
      fileType?: string
      totalChunks?: number
    }

    if (!documentId || !Number.isInteger(totalChunks) || totalChunks! <= 0) {
      return new Response('Invalid payload', { status: 400, headers: corsHeaders })
    }

    const parts: Uint8Array[] = []
    for (let i = 0; i < (totalChunks as number); i++) {
      const key = `upload-chunk:${documentId}:${i.toString().padStart(6, '0')}`
      const chunk = await (env.RAG_KV as any).get(key, 'arrayBuffer')
      if (!chunk) {
        return new Response(`Missing chunk ${i}`, { status: 400, headers: corsHeaders })
      }
      parts.push(new Uint8Array(chunk as ArrayBuffer))
    }

    const totalSize = parts.reduce((sum, p) => sum + p.byteLength, 0)
    const merged = new Uint8Array(totalSize)
    let offset = 0
    for (const p of parts) {
      merged.set(p, offset)
      offset += p.byteLength
    }

    // Cleanup chunks (best effort)
    for (let i = 0; i < (totalChunks as number); i++) {
      const key = `upload-chunk:${documentId}:${i.toString().padStart(6, '0')}`
      try {
        await (env.RAG_KV as any).delete(key)
      } catch {
        // ignore delete errors
      }
    }

    logStructured({
      level: 'info',
      event: 'upload_chunks_assembled',
      metadata: { documentId, totalChunks, totalSize },
    })

    return Response.json(
      {
        ok: true,
        documentId,
        fileName,
        fileType,
        size: totalSize,
      },
      { headers: corsHeaders },
    )
  } catch (error: unknown) {
    return new Response(getErrorMessage(error) || 'Bad Request', { status: 400, headers: corsHeaders })
  }
}

async function handleLogsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const corsHeaders = corsHeadersFor(request, { methods: ['GET', 'OPTIONS'], allowAuth: true })

  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    // Authorization: Bearer <LOGS_API_KEY>
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token || token !== (env as unknown).LOGS_API_KEY) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const action = url.searchParams.get('action') || 'list'

    switch (action) {
      case 'list': {
        // List recent log files
        const limit = parseInt(url.searchParams.get('limit') || '10')
        const listed = await (env.LOGS as any).list({ limit })

        logStructured({
          level: 'info',
          event: 'logs_list_files',
          metadata: { count: listed.objects.length },
        })

        return Response.json(
          {
            files: listed.objects.map((obj: R2ObjectLike) => ({
              key: obj.key,
              size: obj.size,
              uploaded: (() => {
                if (typeof obj.uploaded === 'string') return obj.uploaded
                if (obj.uploaded instanceof Date) return obj.uploaded.toISOString()
                const asDate = new Date(obj.uploaded as string | number)
                return Number.isNaN(asDate.getTime()) ? String(obj.uploaded ?? '') : asDate.toISOString()
              })(),
            })),
            truncated: listed.truncated,
          },
          { headers: corsHeaders }
        )
      }

      case 'get': {
        // Get specific log file
        const key = url.searchParams.get('key')
        if (!key) {
          return new Response('Key parameter required', { status: 400, headers: corsHeaders })
        }

        const object = await (env.LOGS as any).get(key)
        if (!object) {
          return new Response('Log file not found', { status: 404, headers: corsHeaders })
        }

        const content = await object.text()

        logStructured({
          level: 'info',
          event: 'logs_get_file',
          metadata: { key, size: object.size },
        })

        return Response.json({ key, content }, { headers: corsHeaders })
      }

      case 'recent': {
        // Get most recent log entries
        const limit = parseInt(url.searchParams.get('limit') || '100')
        const listed = await (env.LOGS as any).list({ limit: 1 })

        if (listed.objects.length === 0) {
          return Response.json({ logs: [] }, { headers: corsHeaders })
        }

        const latestFile = listed.objects[0]
        const object = await (env.LOGS as any).get(latestFile.key)

        if (!object) {
          return Response.json({ logs: [] }, { headers: corsHeaders })
        }

        const content = await object.text()
        const lines = content.trim().split('\n').slice(-limit)
        const logs = lines.map((line: string) => {
          try {
            return JSON.parse(line)
          } catch {
            return { raw: line }
          }
        })

        logStructured({
          level: 'info',
          event: 'logs_get_recent',
          metadata: { count: logs.length },
        })

        return Response.json({ logs }, { headers: corsHeaders })
      }

      default:
        return new Response('Invalid action', { status: 400, headers: corsHeaders })
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logStructured({
      level: 'error',
      event: 'logs_api_error',
      error: errorMessage,
    })

    return new Response(errorMessage || 'Internal server error', {
      status: 500,
      headers: corsHeaders,
    })
  }
}

/**
 * Handle KV migration from optional LEGACY_KV to RAG_KV
 * Protected via Bearer MIGRATION_KEY and restricted CORS
 */
async function handleMigrationRequest(request: Request, env: Env): Promise<Response> {
  const corsHeaders = corsHeadersFor(request, { methods: ['POST', 'OPTIONS'], allowAuth: true })

  // Preflight
  if (request.method === 'OPTIONS') {
    if (!isOriginAllowed(request)) {
      return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
    }
    return new Response(null, { headers: corsHeaders })
  }

  // Method check
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // CORS check
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
  }

  // Auth: Authorization: Bearer <MIGRATION_KEY>
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token || token !== (env as unknown).MIGRATION_KEY) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (!env.LEGACY_KV) {
    return new Response('LEGACY_KV not configured', { status: 503, headers: corsHeaders })
  }

  try {
    const { prefix = '', limit = 0, dryRun = false } = (await request.json().catch(() => ({}))) as {
      prefix?: string
      limit?: number
      dryRun?: boolean
    }

    let cursor: string | undefined = undefined
    let scanned = 0
    let copied = 0
    let skipped = 0
    const errors: Array<{ key: string; error: string }> = []

    // Iterate KV keys with pagination
    // Note: Workers KV list supports { prefix?, cursor?, limit? }
    // We batch up to 1000 per page.
    while (true) {
      const page = (await env.LEGACY_KV.list(
        { prefix, cursor, limit: 1000 } as { prefix?: string; cursor?: string; limit?: number }
      )) as unknown as { keys: Array<{ name: string }>; cursor?: string; list_complete?: boolean }
      const keys = page.keys as Array<{ name: string }>

      if (!Array.isArray(keys) || keys.length === 0) {
        break
      }

      for (const k of keys) {
        if (limit && scanned >= limit) break
        scanned += 1

        try {
          const value = await (env.LEGACY_KV as any)!.get(k.name)
          if (value === null) {
            skipped += 1
            continue
          }
          if (!dryRun) {
            await (env.RAG_KV as any).put(k.name, value)
          }
          copied += 1
        } catch (e: unknown) {
          skipped += 1
          errors.push({ key: k.name, error: getErrorMessage(e) })
        }
      }

      if (limit && scanned >= limit) break
      // Advance cursor
      cursor = page.cursor
      const listComplete = page.list_complete
      if (!cursor || listComplete === true) break
    }

    logStructured({
      level: 'info',
      event: 'kv_migration',
      metadata: { prefix, scanned, copied, skipped, dryRun, errorCount: errors.length },
    })

    return Response.json(
      { ok: true, prefix, scanned, copied, skipped, dryRun, errorCount: errors.length, errors },
      { headers: corsHeaders }
    )
  } catch (error: unknown) {
    logStructured({
      level: 'error',
      event: 'kv_migration_error',
      error: getErrorMessage(error),
    })
    return new Response(getErrorMessage(error) || 'Migration failed', { status: 500, headers: corsHeaders })
  }
}
