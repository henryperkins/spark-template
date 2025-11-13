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

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: applySecurityHeaders({
      ...corsHeaders,
      'Content-Type': 'application/json'
    })
  })
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
  ANTHROPIC_API_KEY?: string
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

  if (path === '/api/tarot-reading') {
    return handleTarotReadingRequest(request, env, corsHeaders)
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

interface TarotCardPayload {
  position: string
  card: string
  orientation: string
  meaning: string
  number: number
}

function isTarotCardPayload(value: unknown): value is TarotCardPayload {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return (
    typeof card.position === 'string' &&
    typeof card.card === 'string' &&
    typeof card.orientation === 'string' &&
    typeof card.meaning === 'string' &&
    typeof card.number === 'number'
  )
}

async function handleTarotReadingRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: applySecurityHeaders(corsHeaders) })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: 'Tarot reading service is not configured' }, 500, corsHeaders)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders)
  }

  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'Invalid request payload' }, 400, corsHeaders)
  }

  const { spreadKey, spreadName, cards, reflections, userQuestion } = payload as Record<string, unknown>

  if (typeof spreadKey !== 'string' || typeof spreadName !== 'string' || !Array.isArray(cards) || cards.length === 0) {
    return jsonResponse({ error: 'Invalid request payload' }, 400, corsHeaders)
  }

  const normalizedCards = cards.filter(isTarotCardPayload)
  if (normalizedCards.length !== cards.length) {
    return jsonResponse({ error: 'Invalid card payload' }, 400, corsHeaders)
  }

  const reflectionsObject =
    reflections && typeof reflections === 'object' && !Array.isArray(reflections)
      ? (reflections as Record<string, unknown>)
      : {}

  const reversedCount = normalizedCards.filter(card => card.orientation === 'Reversed').length
  const cardsList = normalizedCards
    .map(
      (card, index) =>
        `${index + 1}. ${card.position}: ${card.card} (${card.orientation}) - ${card.meaning.replace(/"/g, "'")}`
    )
    .join('\n')

  const questionText =
    typeof userQuestion === 'string' && userQuestion.trim()
      ? `The querent asks: "${userQuestion.trim().replace(/"/g, "'")}"`
      : 'The querent seeks general guidance.'

  const reflectionsText = Object.entries(reflectionsObject)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, value]) => {
      if (typeof value !== 'string') return ''
      const trimmed = value.trim()
      if (!trimmed) return ''
      const card = normalizedCards[Number(key)]
      const position = card?.position ?? `Position ${Number(key) + 1}`
      return `${position}: ${trimmed}`
    })
    .filter(Boolean)
    .join('\n')

  const prompt = `You are an experienced tarot reader providing a personalized interpretation using advanced techniques.

${questionText}

Spread: ${spreadName}

Cards drawn:
${cardsList}

Querent reflections:
${reflectionsText || 'None provided.'}

IMPORTANT READING TECHNIQUES TO APPLY:

1. PATTERN ANALYSIS: All ${normalizedCards.length} cards are Major Arcana, indicating significant life themes. ${reversedCount} card(s) reversed suggests areas needing attention or internal work.
1. CARD COMBINATIONS: Analyze how adjacent cards interact and influence each other. Look for thematic connections between positions, how earlier cards set the stage for later ones, and contrasts or harmonies between card energies.
1. EMOTIONAL ARC: Trace the emotional journey from the first card to the last. Is there tension and release? Growth and transformation? A clear beginning, middle, and end?
1. POSITIONAL CONTEXT: Weight each card meaning based on its position in the spread. The same card means different things in different positions.
1. NARRATIVE FLOW: Tell a cohesive story that connects all cards together, showing how they form a complete picture rather than isolated meanings.
1. PRACTICAL GUIDANCE: Provide actionable insights and reflection points, not predictions. Focus on empowering choices and paths forward.

Your reading should open with a powerful 1-2 sentence summary that directly answers the question, weave all cards into a unified narrative showing their relationships, acknowledge emotional tensions or conflicts in the spread, highlight opportunities and paths forward, and close with an empowering actionable insight.

Length: 250-350 words. Tone: Warm, insightful, and empowering. Write in second person.

CRITICAL: Write in plain text only. Do NOT use any markdown formatting (no asterisks, no bold, no headers, no bullet points). Use natural paragraph breaks only.`

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text()
      console.error('Anthropic error', anthropicResponse.status, errorBody)
      return jsonResponse({ error: 'Failed to generate reading' }, anthropicResponse.status, corsHeaders)
    }

    const data = await anthropicResponse.json()
    const content = Array.isArray((data as Record<string, unknown>).content)
      ? ((data as Record<string, unknown>).content as Array<{ type?: string; text?: string }>)
      : []

    const readingText = content
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('\n')
      .trim()

    if (!readingText) {
      console.error('Anthropic response missing text content', data)
      return jsonResponse({ error: 'Failed to generate reading' }, 502, corsHeaders)
    }

    return jsonResponse({ reading: readingText }, 200, corsHeaders)
  } catch (error) {
    console.error('Anthropic request failed', error)
    return jsonResponse({ error: 'Failed to generate reading' }, 500, corsHeaders)
  }
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
      // Get value with robust JSON handling
      let value: unknown = null

      try {
        value = await env.RAG_KV.get(key, { type: 'json' })
      } catch (error) {
        // Treat malformed JSON (empty string, partial JSON, etc.) as missing rather than 500
        console.error(`[kv] Failed to parse JSON for key "${key}":`, error instanceof Error ? error.message : String(error))
        value = null
      }

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
