import { useState, useCallback } from 'react'
import { errorTracking } from '@/lib/services/error-tracker'

export type OAuthProvider = 'github' | 'dropbox' | 'onedrive'

export interface OAuthConfig {
  clientId: string
  redirectUri: string
  scope: string[]
  provider: OAuthProvider
}

interface OAuthState {
  loading: boolean
  error: string | null
}

/**
 * useOAuth: Secure OAuth hook with PKCE flow
 *
 * Security Features:
 * - PKCE (Proof Key for Code Exchange) for protection against interception attacks
 * - State parameter for CSRF protection
 * - Worker-mediated token exchange (tokens never exposed to JavaScript)
 * - Secure code verifier storage
 */
export function useOAuth() {
  const [state, setState] = useState<OAuthState>({
    loading: false,
    error: null
  })

  /**
   * Initiates OAuth flow with PKCE
   */
  const initiateOAuth = useCallback(async (config: OAuthConfig) => {
    setState({ loading: true, error: null })

    try {
      // Generate PKCE code verifier and challenge
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // Generate state parameter for CSRF protection
      const stateParam = generateState()

      // Store code verifier securely in Worker (via API)
      const storeResponse = await fetch('/api/oauth/store-verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: stateParam,
          codeVerifier,
          provider: config.provider
        })
      })

      if (!storeResponse.ok) {
        throw new Error('Failed to store OAuth verifier')
      }

      // Build OAuth authorization URL
      const authUrl = getProviderAuthUrl(config.provider)
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.scope.join(' '),
        state: stateParam,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code'
      })

      // Redirect to OAuth provider
      window.location.href = `${authUrl}?${params.toString()}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'OAuth initiation failed'

      setState({ loading: false, error: errorMessage })

      errorTracking.record(error as Error, {
        type: 'network',
        agent: 'useOAuth',
        code: 'oauth_initiation_failed'
      })
    }
  }, [])

  /**
   * Checks OAuth callback result
   */
  const checkOAuthResult = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    const success = params.get('oauth')
    const error = params.get('error')

    if (error) {
      return { success: false, error }
    }

    if (success === 'success') {
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname)
      return { success: true, error: null }
    }

    return { success: false, error: null }
  }, [])

  return {
    initiateOAuth,
    checkOAuthResult,
    loading: state.loading,
    error: state.error
  }
}

/**
 * Generates a cryptographically secure code verifier for PKCE
 * Spec: 43-128 characters from [A-Z a-z 0-9 - . _ ~]
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)

  return base64UrlEncode(array)
}

/**
 * Generates code challenge from verifier using SHA-256
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)

  return base64UrlEncode(new Uint8Array(hash))
}

/**
 * Generates a random state parameter for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)

  return base64UrlEncode(array)
}

/**
 * Base64 URL-safe encoding (without padding)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Returns OAuth authorization URL for provider
 */
function getProviderAuthUrl(provider: OAuthProvider): string {
  const urls: Record<OAuthProvider, string> = {
    github: 'https://github.com/login/oauth/authorize',
    dropbox: 'https://www.dropbox.com/oauth2/authorize',
    onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
  }

  return urls[provider]
}

/**
 * Returns OAuth client configuration from environment
 * Note: These should be public client IDs (not secrets)
 */
export function getOAuthConfig(provider: OAuthProvider): Omit<OAuthConfig, 'provider'> {
  const configs: Record<OAuthProvider, Omit<OAuthConfig, 'provider'>> = {
    github: {
      clientId: import.meta.env.VITE_GITHUB_CLIENT_ID || '',
      redirectUri: `${window.location.origin}/api/oauth/github/callback`,
      scope: ['repo', 'read:user']
    },
    dropbox: {
      clientId: import.meta.env.VITE_DROPBOX_CLIENT_ID || '',
      redirectUri: `${window.location.origin}/api/oauth/dropbox/callback`,
      scope: ['files.content.read', 'files.metadata.read']
    },
    onedrive: {
      clientId: import.meta.env.VITE_ONEDRIVE_CLIENT_ID || '',
      redirectUri: `${window.location.origin}/api/oauth/onedrive/callback`,
      scope: ['Files.Read', 'Files.Read.All', 'offline_access']
    }
  }

  return configs[provider]
}
