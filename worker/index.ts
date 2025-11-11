import { handleListDocuments, handleGetDocument, handleUpdateDocument, handleDeleteDocument, handleGetChunks } from './document-api'
import {
  handleStoreVerifier,
  handleOAuthCallback,
  handleOneDriveToken,
  handleOneDriveRefresh,
  handleDropboxToken,
  handleDropboxRefresh
} from './oauth-handler'

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; " +
    "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' https://api.github.com https://login.microsoftonline.com https://graph.microsoft.com https://api.dropboxapi.com https://content.dropboxapi.com;",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
} as const

function applySecurityHeaders(
  headers: Headers | Record<string, string>
): Headers {
  const h = headers instanceof Headers ? headers : new Headers(headers)
  for (const [k, v] of Object.entries(securityHeaders)) {
    if (!h.has(k)) h.set(k, v)
  }
  return h
}
import { wrapRequestHandler } from '@sentry/cloudflare'

export interface Env {
  KV_API_KEY: string
  RAG_KV: KVNamespace
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_KV_NAMESPACE_ID?: string
  AZURE_OPENAI_API_KEY?: string
  AZURE_OPENAI_ENDPOINT?: string
  AZURE_OPENAI_DEPLOYMENT?: string
  AZURE_SEARCH_KEY?: string
  AZURE_SEARCH_ENDPOINT?: string
  AZURE_SEARCH_INDEX?: string
  WORKER_URL?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  DROPBOX_CLIENT_ID?: string
  DROPBOX_CLIENT_SECRET?: string
  ONEDRIVE_CLIENT_ID?: string
  ONEDRIVE_CLIENT_SECRET?: string
  VITE_APP_ENV?: string
  SENTRY_DSN?: string
  SENTRY_TRACES_SAMPLE_RATE?: string
  SENTRY_ENVIRONMENT?: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.SENTRY_DSN) {
      return handleRequest(request, env)
    }

    const tracesSampleRate = parseFloat(env.SENTRY_TRACES_SAMPLE_RATE ?? '0')

    return wrapRequestHandler(
      {
        request,
        context: ctx,
        options: {
          dsn: env.SENTRY_DSN,
          environment: env.SENTRY_ENVIRONMENT ?? env.VITE_APP_ENV ?? 'production',
          tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0
        }
      },
      () => handleRequest(request, env)
    )
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: applySecurityHeaders(corsHeaders) })
  }

  // Azure Search proxy routes (avoids browser CORS issues and keeps keys server-side)
  if (path.startsWith('/api/azure-search')) {
    return handleAzureSearchRequest(request, env, corsHeaders)
  }

  if (path === '/api/oauth/store-verifier') {
    return handleStoreVerifier(request, env)
  }

  if (path === '/api/oauth/onedrive/token') {
    return handleOneDriveToken(request, env)
  }

  if (path === '/api/oauth/onedrive/refresh') {
    return handleOneDriveRefresh(request, env)
  }

  if (path === '/api/oauth/dropbox/token') {
    return handleDropboxToken(request, env)
  }

  if (path === '/api/oauth/dropbox/refresh') {
    return handleDropboxRefresh(request, env)
  }

  const oauthCallbackMatch = path.match(/^\/api\/oauth\/(github|dropbox|onedrive)\/callback$/)
  if (oauthCallbackMatch) {
    const provider = oauthCallbackMatch[1] as 'github' | 'dropbox' | 'onedrive'
    return handleOAuthCallback(request, env, provider)
  }

  // KV API routes
  if (path.startsWith('/api/kv')) {
    return handleKVRequest(request, env)
  }

  // Telemetry endpoint: accept client events, return 204 on success
  if (path === '/api/telemetry' && method === 'POST') {
    try {
      // Best-effort structured log; Cloudflare Workers logs will capture this
      const body = await request.text()
      console.log('[telemetry] client_event', body || '{}')
    } catch (err) {
      console.error('[telemetry] failed to read body', err)
    }
    return new Response(null, {
      status: 204,
      headers: applySecurityHeaders(corsHeaders)
    })
  }

  // Document API routes
  if (path.startsWith('/api/documents')) {
    return handleDocumentRequest(request, env)
  }

  // Default response
  return new Response('Not Found', {
    status: 404,
    headers: applySecurityHeaders(corsHeaders)
  })
}

async function handleAzureSearchRequest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const endpoint = env.AZURE_SEARCH_ENDPOINT?.replace(/\/+$/, '')
  const apiKey = env.AZURE_SEARCH_KEY

  if (!endpoint || !apiKey) {
    return new Response(
      JSON.stringify({ error: 'Azure Search proxy is not configured on the Worker' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  const forwardToAzure = async (targetUrl: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('api-key', apiKey)
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json')
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const azureResponse = await fetch(targetUrl, { ...init, headers })
    const responseHeaders = new Headers(azureResponse.headers)
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value)
    }
    return new Response(azureResponse.body, {
      status: azureResponse.status,
      headers: responseHeaders
    })
  }

  try {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/azure-search/search' && request.method === 'POST') {
      const { indexName, apiVersion, request: searchRequest } = await request.json()
      if (!indexName || !apiVersion || !searchRequest) {
        return new Response(
          JSON.stringify({ error: 'Missing indexName, apiVersion, or request payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const targetUrl = `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search?api-version=${encodeURIComponent(apiVersion)}`
      return forwardToAzure(targetUrl, {
        method: 'POST',
        body: JSON.stringify(searchRequest)
      })
    }

    if (path === '/api/azure-search/index' && request.method === 'POST') {
      const { indexName, apiVersion, batch } = await request.json()
      if (!indexName || !apiVersion || !batch) {
        return new Response(
          JSON.stringify({ error: 'Missing indexName, apiVersion, or batch payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const targetUrl = `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/index?api-version=${encodeURIComponent(apiVersion)}`
      return forwardToAzure(targetUrl, {
        method: 'POST',
        body: JSON.stringify(batch)
      })
    }

    if (path === '/api/azure-search/create-index' && request.method === 'POST') {
      const { indexName, apiVersion, schema, allowIndexDowntime } = await request.json()
      if (!indexName || !apiVersion || !schema) {
        return new Response(
          JSON.stringify({ error: 'Missing indexName, apiVersion, or schema payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const targetUrl = new URL(`${endpoint}/indexes/${encodeURIComponent(indexName)}`)
      targetUrl.searchParams.set('api-version', apiVersion)
      if (allowIndexDowntime) {
        targetUrl.searchParams.set('allowIndexDowntime', 'true')
      }
      return forwardToAzure(targetUrl.toString(), {
        method: 'PUT',
        body: JSON.stringify(schema)
      })
    }

    if (path === '/api/azure-search/analyze' && request.method === 'POST') {
      const { indexName, apiVersion, request: analyzeRequest } = await request.json()
      if (!indexName || !apiVersion || !analyzeRequest) {
        return new Response(
          JSON.stringify({ error: 'Missing indexName, apiVersion, or analyze payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const targetUrl = `${endpoint}/indexes/${encodeURIComponent(indexName)}/analyze?api-version=${encodeURIComponent(apiVersion)}`
      return forwardToAzure(targetUrl, {
        method: 'POST',
        body: JSON.stringify(analyzeRequest)
      })
    }

    if (path.startsWith('/api/azure-search/indexes/')) {
      if (!['GET', 'DELETE'].includes(request.method)) {
        return new Response(
          JSON.stringify({ error: 'Method not allowed' }),
          { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const azurePath = path.replace('/api/azure-search', '')
      const targetUrl = new URL(`${endpoint}${azurePath}`)
      url.searchParams.forEach((value, key) => {
        if (key === 'apiVersion') {
          targetUrl.searchParams.set('api-version', value)
        } else {
          targetUrl.searchParams.set(key, value)
        }
      })
      return forwardToAzure(targetUrl.toString(), {
        method: request.method
      })
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Azure Search proxy error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
}

async function handleKVRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // Extract key from path
  const keyMatch = path.match(/^\/api\/kv\/(.+)$/)
  const key = keyMatch ? decodeURIComponent(keyMatch[1]) : ''

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Check authorization
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const token = authHeader.slice(7)
  if (token !== env.KV_API_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    if (method === 'GET' && path === '/api/kv') {
      // List keys with pagination
      const cursor = url.searchParams.get('cursor')
      const allKeys: string[] = []
      let listComplete = false
      let currentCursor = cursor

      while (!listComplete) {
        const result = await env.RAG_KV.list({ cursor: currentCursor || undefined })
        allKeys.push(...result.keys.map(k => k.name))
        
        if (result.list_complete) {
          listComplete = true
        } else {
          currentCursor = result.cursor
        }
      }

      return new Response(JSON.stringify({ 
        keys: allKeys, 
        cursor: currentCursor,
        list_complete: listComplete 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (method === 'GET' && key) {
      // Get value
      const value = await env.RAG_KV.get(key, { type: 'json' })
      
      if (value === null) {
        return new Response(JSON.stringify({ configured: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify(value), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (method === 'POST' && key) {
        // Set value
        const body = await request.text()
        await env.RAG_KV.put(key, body)
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

    if (method === 'DELETE' && key) {
      // Delete value
      await env.RAG_KV.delete(key)
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

async function handleDocumentRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Check authorization for mutating operations
  if (method !== 'GET') {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.slice(7)
    if (token !== env.KV_API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // Route handling
  const documentsMatch = path.match(/^\/api\/documents\/?$/)
  const documentIdMatch = path.match(/^\/api\/documents\/([^/]+)\/?$/)
  const chunksMatch = path.match(/^\/api\/documents\/([^/]+)\/chunks\/?$/)

  if (documentsMatch && method === 'GET') {
    return handleListDocuments(request, env)
  }

  if (documentIdMatch) {
    const documentId = documentIdMatch[1]
    
    if (method === 'GET') {
      return handleGetDocument(request, env, documentId)
    }
    
    if (method === 'POST') {
      return handleUpdateDocument(request, env, documentId)
    }
    
    if (method === 'DELETE') {
      return handleDeleteDocument(request, env, documentId)
    }
  }

  if (chunksMatch && method === 'GET') {
    const documentId = chunksMatch[1]
    return handleGetChunks(request, env, documentId)
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
