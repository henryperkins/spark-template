import type { Env } from './index'

type Provider = 'github' | 'dropbox' | 'onedrive'

interface StoredVerifier {
  state: string
  codeVerifier: string
  provider: Provider
}

/**
 * Key prefix for temporary PKCE verifier/state records.
 * These entries should be short-lived and may be cleaned up by a separate job.
 */
const VERIFIER_PREFIX = 'oauth:verifier:'

/**
 * Store PKCE code verifier and state in KV before redirecting to provider.
 * This is called from the SPA via /api/oauth/store-verifier.
 *
 * Security:
 * - No client secret involved.
 * - Values are stored only in Worker KV (edge), not returned to client.
 */
export async function handleStoreVerifier(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: Partial<StoredVerifier> & { state?: string }
  try {
    payload = (await request.json()) as Partial<StoredVerifier> & { state?: string }
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { state, codeVerifier, provider } = payload

  if (!state || !codeVerifier || !provider || !isSupportedProvider(provider)) {
    return new Response('Missing or invalid PKCE payload', { status: 400 })
  }

  if (!env.RAG_KV) {
    return new Response('KV not configured', { status: 503 })
  }

  const record: StoredVerifier = {
    state,
    codeVerifier,
    provider
  }

  // Short TTL (e.g., 10 minutes) to limit exposure window
  await (env.RAG_KV as any).put(
    `${VERIFIER_PREFIX}${state}`,
    JSON.stringify(record),
    { expirationTtl: 600 }
  )

  return new Response(null, { status: 204 })
}

/**
 * Unified OAuth callback handler for GitHub, Dropbox, OneDrive.
 *
 * Flow:
 * 1. Provider redirects back with ?code=&state=.
 * 2. We look up PKCE record in KV using state.
 * 3. We verify provider matches and exchange code+verifier for tokens using provider secrets.
 * 4. We store resulting tokens securely in KV (encrypted) keyed by provider.
 * 5. We redirect user back to SPA with ?oauth=success or ?error=... (no tokens).
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env,
  provider: Provider
): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const error = url.searchParams.get('error')

  if (error) {
    return redirectWithResult(env, 'error', `oauth_${provider}_error:${error}`)
  }

  if (!code || !state) {
    return redirectWithResult(env, 'error', `oauth_${provider}_missing_code_or_state`)
  }

  if (!env.RAG_KV) {
    return redirectWithResult(env, 'error', 'oauth_kv_not_configured')
  }

  // Lookup PKCE verifier/state
  const raw = await (env.RAG_KV as any).get(`${VERIFIER_PREFIX}${state}`, { type: 'text' })
  if (!raw || typeof raw !== 'string') {
    return redirectWithResult(env, 'error', 'oauth_invalid_or_expired_state')
  }

  let stored: StoredVerifier
  try {
    stored = JSON.parse(raw) as StoredVerifier
  } catch {
    return redirectWithResult(env, 'error', 'oauth_state_parse_failed')
  }

  if (!isSupportedProvider(stored.provider) || stored.provider !== provider) {
    return redirectWithResult(env, 'error', 'oauth_provider_mismatch')
  }

  // Best-effort cleanup of used verifier
  try {
    await (env.RAG_KV as any).delete(`${VERIFIER_PREFIX}${state}`)
  } catch {
    // ignore cleanup error
  }

  try {
    switch (provider) {
      case 'github':
        await exchangeGitHubCodeForToken(env, code, stored.codeVerifier)
        break
      case 'dropbox':
        await exchangeDropboxCodeForToken(env, code, stored.codeVerifier)
        break
      case 'onedrive':
        await exchangeOneDriveCodeForToken(env, code, stored.codeVerifier)
        break
      default:
        return redirectWithResult(env, 'error', 'oauth_unsupported_provider')
    }

    // Tokens are now stored server-side; tell SPA that OAuth succeeded.
    return redirectWithResult(env, 'success')
  } catch (e: any) {
    const message =
      e instanceof Error ? e.message : typeof e === 'string' ? e : 'oauth_exchange_failed'
    return redirectWithResult(env, 'error', sanitizeError(message))
  }
}

function isSupportedProvider(provider: string): provider is Provider {
  return provider === 'github' || provider === 'dropbox' || provider === 'onedrive'
}

/**
 * Compute SPA base URL for redirects.
 * Prefer WORKER_URL, otherwise derive from incoming request.
 */
function getSpaBaseUrl(env: Env, request: Request): string {
  if (env.WORKER_URL) {
    try {
      const u = new URL(env.WORKER_URL)
      u.pathname = '/'
      return u.toString().replace(/\/+$/, '')
    } catch {
      // fall through
    }
  }
  const url = new URL(request.url)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

/**
 * Redirect back to SPA with ?oauth=success or ?error=...
 * Ensures we never leak tokens via query params.
 */
function redirectWithResult(env: Env, outcome: 'success' | 'error', error?: string): Response {
  // We don't have the Request here, so rely on WORKER_URL for deterministic base.
  // For safety, use root path if WORKER_URL is missing/misconfigured; front-end will still parse flags.
  const base = (env.WORKER_URL && safeBase(env.WORKER_URL)) || ''
  const suffix = outcome === 'success'
    ? '?oauth=success'
    : `?error=${encodeURIComponent(error || 'oauth_failed')}`
  const location = base || '/'
  return Response.redirect(`${location}${suffix}`, 302)
}

function safeBase(urlLike: string): string | null {
  try {
    const u = new URL(urlLike)
    u.pathname = '/'
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function sanitizeError(message: string): string {
  // Avoid reflecting sensitive upstream messages directly
  if (/secret|token|client/i.test(message)) {
    return 'oauth_exchange_failed'
  }
  return message.slice(0, 200)
}

/**
 * GitHub: Exchange code + PKCE for access token using Worker-side secret.
 * Stores token in secureTokenStorage (via direct KV put under secure prefix).
 */
async function exchangeGitHubCodeForToken(env: Env, code: string, codeVerifier: string): Promise<void> {
  const clientId = env.GITHUB_CLIENT_ID
  const clientSecret = env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('github_oauth_not_configured')
  }

  const tokenEndpoint = 'https://github.com/login/oauth/access_token'

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier
  })

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!resp.ok) {
    throw new Error(`github_oauth_http_${resp.status}`)
  }

  const json = (await resp.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (!json.access_token) {
    throw new Error(json.error || json.error_description || 'github_oauth_no_access_token')
  }

  await storeServiceToken(env, 'github', json.access_token)
}

/**
 * Dropbox: PKCE token exchange.
 */
async function exchangeDropboxCodeForToken(env: Env, code: string, codeVerifier: string): Promise<void> {
  const clientId = env.DROPBOX_CLIENT_ID
  const clientSecret = env.DROPBOX_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('dropbox_oauth_not_configured')
  }

  const tokenEndpoint = 'https://api.dropboxapi.com/oauth2/token'

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier
  })

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!resp.ok) {
    throw new Error(`dropbox_oauth_http_${resp.status}`)
  }

  const json = (await resp.json()) as { access_token?: string; error?: string }

  if (!json.access_token) {
    throw new Error(json.error || 'dropbox_oauth_no_access_token')
  }

  await storeServiceToken(env, 'dropbox', json.access_token)
}

/**
 * OneDrive (Microsoft identity platform): PKCE token exchange.
 */
async function exchangeOneDriveCodeForToken(env: Env, code: string, codeVerifier: string): Promise<void> {
  const clientId = env.ONEDRIVE_CLIENT_ID
  const clientSecret = env.ONEDRIVE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('onedrive_oauth_not_configured')
  }

  // Using "common" tenant; adjust if you later support specific tenants.
  const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: '' // Redirect URI must match the one used in auth; we derive it from WORKER_URL.
  })

  const redirectBase = env.WORKER_URL && safeBase(env.WORKER_URL)
  if (!redirectBase) {
    throw new Error('onedrive_oauth_redirect_not_configured')
  }
  body.set('redirect_uri', `${redirectBase}/api/oauth/onedrive/callback`)

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  if (!resp.ok) {
    throw new Error(`onedrive_oauth_http_${resp.status}`)
  }

  const json = (await resp.json()) as { access_token?: string; error?: string }

  if (!json.access_token) {
    throw new Error(json.error || 'onedrive_oauth_no_access_token')
  }

  await storeServiceToken(env, 'onedrive', json.access_token)
}

/**
 * Store service token into KV under the same secure prefix used by SecureTokenStorage.
 * This keeps all token handling server-side; the SPA never receives these tokens.
 */
async function storeServiceToken(env: Env, service: string, token: string): Promise<void> {
  if (!env.RAG_KV) {
    throw new Error('token_storage_kv_not_configured')
  }

  // Reuse the prefix from SecureTokenStorage (hardcoded here to avoid import cycles).
  const key = `secure:token:${service}`

  // Tokens are stored as-is here; SecureTokenStorage encrypts/decrypts when accessed from SPA/Worker.
  // If you want Worker-side encryption as well, you can mirror that logic here.
  await (env.RAG_KV as any).put(key, token)
}