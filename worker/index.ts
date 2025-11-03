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
 // Fallback CF types if Workers types aren't available in local tsserver
 // (Build uses official @cloudflare/workers-types via triple-slash reference)
 type KVNamespace = any
 type R2Bucket = any
 type Fetcher = any
 type ExecutionContext = any

export interface Env {
  RAG_KV: KVNamespace
  LOGS: R2Bucket // R2 bucket for Logpush logs
  ASSETS: Fetcher
  VITE_CLOUDFLARE_API_TOKEN?: string
  VITE_AZURE_OPENAI_KEY?: string
  VITE_AZURE_SEARCH_KEY?: string
  LOGS_API_KEY?: string
  KV_API_KEY?: string
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
  metadata?: Record<string, any>
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
  'https://spark.example.com',
  'https://staging.spark.example.com',
  'https://paradigmfind.com',
  'https://www.paradigmfind.com',
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const startTime = Date.now()

    try {
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

      // API endpoint for Azure Search proxy (avoids CORS)
      if (url.pathname.startsWith('/api/azure-search')) {
        return handleAzureSearchRequest(request, env)
      }

      // Health/ping for Spark front-end integrations
      if (url.pathname === '/_spark/loaded') {
        const corsHeaders = corsHeadersFor(request, { methods: ['GET', 'OPTIONS'] })
        if (request.method === 'OPTIONS') {
          if (!isOriginAllowed(request)) {
            return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
          }
          return new Response(null, { headers: corsHeaders })
        }
        if (request.headers.get('Origin') && !isOriginAllowed(request)) {
          return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
        }
        return Response.json({ loaded: true }, { headers: corsHeaders })
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
      const response = await env.ASSETS.fetch(request)

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
    } catch (error: any) {
      const duration = Date.now() - startTime

      logStructured({
        level: 'error',
        event: 'request_error',
        method: request.method,
        path: url.pathname,
        error: error.message,
        duration,
      })

      return new Response('Internal Server Error', { status: 500 })
    }
  },
}

/**
 * Handle KV API requests
 * Provides REST API for client-side KV operations
 */
async function handleKVRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/kv', '')
  const key = path.slice(1) // Remove leading slash

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

  // Enforce origin on CORS requests
  if (request.headers.get('Origin') && !isOriginAllowed(request)) {
    return new Response('CORS origin not allowed', { status: 403, headers: corsHeaders })
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

          const listed = await env.RAG_KV.list(listOptions as KVNamespaceListOptions)
          logStructured({
            level: 'info',
            event: 'kv_list_keys',
            metadata: {
              count: listed.keys.length,
              cursorSupplied: Boolean(cursorParam),
              nextCursor: listed.cursor ?? null,
              listComplete: listed.list_complete ?? false,
            },
          })
          return Response.json(
            {
              keys: listed.keys.map((k: { name: string }) => k.name),
              cursor: listed.cursor ?? null,
              list_complete: listed.list_complete ?? false,
            },
            { headers: corsHeaders }
          )
        }

        // Get single key
        const value = await env.RAG_KV.get(key, { type: 'json' })
        if (value === null) {
          logStructured({
            level: 'warn',
            event: 'kv_key_not_found',
            key,
          })
          return new Response('Not found', { status: 404, headers: corsHeaders })
        }

        logStructured({
          level: 'info',
          event: 'kv_get_key',
          key,
        })
        return Response.json(value, { headers: corsHeaders })
      }

      case 'POST': {
        if (!key) {
          return new Response('Key required', { status: 400, headers: corsHeaders })
        }

        const body = await request.text()
        await env.RAG_KV.put(key, body)

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

        await env.RAG_KV.delete(key)

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
  } catch (error: any) {
    logStructured({
      level: 'error',
      event: 'kv_operation_error',
      method: request.method,
      key,
      error: error.message,
    })

    return new Response(error.message || 'Internal server error', {
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

  // Optional bearer enforcement (reuse KV_API_KEY if configured)
  const expectedBearer = (env as any).KV_API_KEY as string | undefined
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
    (env as any).VITE_AZURE_SEARCH_ENDPOINT
  const endpoint = (rawEndpoint || '').replace(/\/+$/, '')
  const apiKey =
    env.AZURE_SEARCH_KEY ||
    (env as any).VITE_AZURE_SEARCH_KEY

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
      const apiVersion = body.apiVersion || '2025-08-01-preview'
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
      const apiVersion = body.apiVersion || '2025-08-01-preview'
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
        apiVersion?: string
        schema: Record<string, unknown>
      }
      if (!body?.schema) {
        return new Response('schema required', { status: 400, headers: corsHeaders })
      }
      const apiVersion = body.apiVersion || '2025-08-01-preview'
      const forwardUrl = `${endpoint}/indexes?api-version=${encodeURIComponent(apiVersion)}`
      const resp = await fetch(forwardUrl, {
        method: 'POST',
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
      const apiVersion = url.searchParams.get('apiVersion') || '2025-08-01-preview'
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
    if (!token || token !== (env as any).LOGS_API_KEY) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const action = url.searchParams.get('action') || 'list'

    switch (action) {
      case 'list': {
        // List recent log files
        const limit = parseInt(url.searchParams.get('limit') || '10')
        const listed = await env.LOGS.list({ limit })

        logStructured({
          level: 'info',
          event: 'logs_list_files',
          metadata: { count: listed.objects.length },
        })

        return Response.json(
          {
            files: listed.objects.map((obj: any) => ({
              key: obj.key,
              size: obj.size,
              uploaded: (() => {
                if (typeof obj.uploaded === 'string') return obj.uploaded
                if (obj.uploaded instanceof Date) return obj.uploaded.toISOString()
                const asDate = new Date(obj.uploaded as any)
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

        const object = await env.LOGS.get(key)
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
        const listed = await env.LOGS.list({ limit: 1 })

        if (listed.objects.length === 0) {
          return Response.json({ logs: [] }, { headers: corsHeaders })
        }

        const latestFile = listed.objects[0]
        const object = await env.LOGS.get(latestFile.key)

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
  if (!token || token !== (env as any).MIGRATION_KEY) {
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
          const value = await env.LEGACY_KV!.get(k.name)
          if (value === null) {
            skipped += 1
            continue
          }
          if (!dryRun) {
            await env.RAG_KV.put(k.name, value)
          }
          copied += 1
        } catch (e: any) {
          skipped += 1
          errors.push({ key: k.name, error: e?.message ?? String(e) })
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
  } catch (error: any) {
    logStructured({
      level: 'error',
      event: 'kv_migration_error',
      error: error?.message ?? String(error),
    })
    return new Response(error?.message || 'Migration failed', { status: 500, headers: corsHeaders })
  }
}
