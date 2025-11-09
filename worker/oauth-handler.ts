/**
 * OAuth Handler for Cloudflare Worker
 *
 * Implements secure OAuth 2.0 flow with PKCE:
 * 1. Store code verifier (from client)
 * 2. Exchange authorization code for access token
 * 3. Store access token securely in KV
 * 4. Tokens NEVER exposed to JavaScript - Worker-mediated only
 */

import { Env } from './index'

interface OAuthVerifier {
  state: string
  codeVerifier: string
  provider: 'github' | 'dropbox' | 'onedrive'
}

interface OAuthCallback {
  code: string
  state: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  scope?: string
  expires_in?: number
  refresh_token?: string
}

/**
 * Stores OAuth code verifier securely in KV
 * POST /api/oauth/store-verifier
 */
export async function handleStoreVerifier(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as OAuthVerifier

    if (!body.state || !body.codeVerifier || !body.provider) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Store verifier with 10-minute expiration (OAuth should complete quickly)
    const key = `oauth:verifier:${body.state}`
    await env.RAG_KV.put(key, JSON.stringify({
      codeVerifier: body.codeVerifier,
      provider: body.provider,
      timestamp: Date.now()
    }), {
      expirationTtl: 600 // 10 minutes
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('[oauth] store-verifier error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Handles OAuth callback and exchanges code for token
 * GET /api/oauth/{provider}/callback?code=...&state=...
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env,
  provider: 'github' | 'dropbox' | 'onedrive'
): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // Validate parameters
  if (!code || !state) {
    return redirectWithError('missing_params')
  }

  try {
    // Retrieve stored verifier
    const key = `oauth:verifier:${state}`
    const storedData = await env.RAG_KV.get(key)

    if (!storedData) {
      return redirectWithError('invalid_state')
    }

    const { codeVerifier, provider: storedProvider } = JSON.parse(storedData)

    // Verify provider matches
    if (storedProvider !== provider) {
      return redirectWithError('provider_mismatch')
    }

    // Exchange code for access token
    const tokens = await exchangeCodeForTokens(code, codeVerifier, provider, env)

    // Store tokens securely in KV
    const tokenKey = `secure:token:${provider}`
    await env.RAG_KV.put(tokenKey, JSON.stringify({
      accessToken: tokens.access_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      expiresAt: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null,
      refreshToken: tokens.refresh_token,
      createdAt: Date.now()
    }))

    // Clean up verifier (one-time use)
    await env.RAG_KV.delete(key)

    // Redirect back to app with success
    return new Response(null, {
      status: 302,
      headers: { Location: '/?oauth=success' }
    })
  } catch (error) {
    console.error(`[oauth] ${provider} callback error:`, error)
    return redirectWithError('exchange_failed')
  }
}

/**
 * Exchanges authorization code for access token
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  provider: 'github' | 'dropbox' | 'onedrive',
  env: Env
): Promise<TokenResponse> {
  const config = getProviderConfig(provider, env)

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret || '',
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri
  })

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      ...(provider === 'github' ? { 'User-Agent': 'CloudflareWorker-RAG' } : {})
    },
    body: body.toString()
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
  }

  return await response.json() as TokenResponse
}

/**
 * Gets provider-specific configuration from environment
 */
function getProviderConfig(provider: 'github' | 'dropbox' | 'onedrive', env: Env) {
  const baseUrl = env.WORKER_URL || 'http://localhost:8787'

  const configs = {
    github: {
      clientId: env.GITHUB_CLIENT_ID || '',
      clientSecret: env.GITHUB_CLIENT_SECRET || '',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      redirectUri: `${baseUrl}/api/oauth/github/callback`
    },
    dropbox: {
      clientId: env.DROPBOX_CLIENT_ID || '',
      clientSecret: env.DROPBOX_CLIENT_SECRET || '',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      redirectUri: `${baseUrl}/api/oauth/dropbox/callback`
    },
    onedrive: {
      clientId: env.ONEDRIVE_CLIENT_ID || '',
      clientSecret: env.ONEDRIVE_CLIENT_SECRET || '',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      redirectUri: `${baseUrl}/api/oauth/onedrive/callback`
    }
  }

  return configs[provider]
}

/**
 * Returns a redirect response with error parameter
 */
function redirectWithError(error: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/?error=${error}` }
  })
}

/**
 * Retrieves stored access token for provider
 * Worker-only endpoint - tokens never sent to client
 */
export async function getProviderToken(
  provider: 'github' | 'dropbox' | 'onedrive',
  env: Env
): Promise<string | null> {
  try {
    const tokenKey = `secure:token:${provider}`
    const storedData = await env.RAG_KV.get(tokenKey)

    if (!storedData) {
      return null
    }

    const { accessToken, expiresAt } = JSON.parse(storedData)

    // Check if token is expired
    if (expiresAt && Date.now() > expiresAt) {
      // TODO: Implement token refresh logic
      return null
    }

    return accessToken
  } catch (error) {
    console.error(`[oauth] get-token error for ${provider}:`, error)
    return null
  }
}

/**
 * Deletes stored token (logout)
 */
export async function deleteProviderToken(
  provider: 'github' | 'dropbox' | 'onedrive',
  env: Env
): Promise<void> {
  const tokenKey = `secure:token:${provider}`
  await env.RAG_KV.delete(tokenKey)
}
