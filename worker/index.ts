/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entry point
 * Serves the React SPA and provides API endpoints for KV operations
 */

export interface Env {
  RAG_KV: KVNamespace
  LOGS: R2Bucket // R2 bucket for Logpush logs
  ASSETS: Fetcher
  VITE_CLOUDFLARE_API_TOKEN?: string
  VITE_AZURE_OPENAI_KEY?: string
  VITE_AZURE_SEARCH_KEY?: string
  LOGS_API_KEY?: string
  // Optional legacy KV for one-shot migration
  LEGACY_KV?: KVNamespace
  // Secret key to authorize migration
  MIGRATION_KEY?: string
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
  const corsHeaders = corsHeadersFor(request, { methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] })

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

  try {
    switch (request.method) {
      case 'GET': {
        if (!key) {
          // List all keys
          const keys = await env.RAG_KV.list()
          logStructured({
            level: 'info',
            event: 'kv_list_keys',
            metadata: { count: keys.keys.length },
          })
          return Response.json(keys.keys.map((k: { name: string }) => k.name), { headers: corsHeaders })
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
              uploaded: obj.uploaded.toISOString(),
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
  } catch (error: any) {
    logStructured({
      level: 'error',
      event: 'logs_api_error',
      error: error.message,
    })

    return new Response(error.message || 'Internal server error', {
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
