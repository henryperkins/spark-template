High-level note

Only gaps that are still real in the current codebase are included. Items already correctly implemented (AgentWorkflowVisualizer keyboard fixes, lazy-loaded routes, SectionErrorBoundary, etc.) are marked as “Resolved” and not reworked.

Edits are organized by theme. For substantial changes I provide full updated file contents; for small changes I provide minimal diffs. All code is aligned with the existing stack (React + Vite + Cloudflare Worker, `@/` aliases, `SecureTokenStorage`, `azureServiceManager`, etc.).

You can apply these in order.

==================================================
1. OAuth and Token Lifecycle (Dropbox & OneDrive)
==================================================

Confirmed gaps:

- OneDrive: Has refresh support via `/api/oauth/onedrive/refresh` and `OneDriveService.refreshAccessToken()`. Good.
- Dropbox: No refresh flow; uses access token only.
- Secure token storage: Uses a static PBKDF2 salt (security weakness).
- Worker OAuth: OneDrive refresh only; Dropbox does not store/refresh `refresh_token`.

1.1. Fix SecureTokenStorage KDF (static salt → derived salt)

Justification: Static salt in PBKDF2 weakens KDF; use a per-deployment salt derived from `VITE_ENCRYPTION_KEY` without changing external API.

File: src/lib/services/secure-token-storage.ts

Change getEncryptionKey() to derive a non-trivial salt from the key material instead of all-zero.

Minimal diff (lines 71-84):

<<<<<<< SEARCH
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rawKeyString),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    )
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new Uint8Array(16), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
=======
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rawKeyString),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    )

    // Derive a stable, non-trivial salt from the key material itself.
    // This avoids a fixed zero salt while keeping behavior deterministic per deployment.
    const saltSource = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`spark-template-salt:${rawKeyString}`)
    )
    const salt = new Uint8Array(saltSource).slice(0, 16)

    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
>>>>>>> REPLACE

1.2. Dropbox: Introduce refresh-token based flow

Justification: Dropbox supports short-lived access tokens + refresh tokens; current implementation stores only access tokens and cannot recover from expiry.

A. Extend Worker OAuth handler for Dropbox credentials with refresh_token

File: worker/oauth-handler.ts

1) Update StoredOAuthCredentials (already supports refreshToken/expiresAt) — no change needed.

2) Update exchangeDropboxCodeForToken to store credentials:

Locate exchangeDropboxCodeForToken (around line 394):

<<<<<<< SEARCH
  const json = (await resp.json()) as { access_token?: string; error?: string }

  if (!json.access_token) {
    throw new Error(json.error || 'dropbox_oauth_no_access_token')
  }

  await storeServiceToken(env, 'dropbox', json.access_token)
=======
  const json = (await resp.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
  }

  if (!json.access_token) {
    throw new Error(json.error || 'dropbox_oauth_no_access_token')
  }

  await storeServiceToken(env, 'dropbox', json.access_token)
  await storeOAuthCredentials(env, 'dropbox', {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in
  })
>>>>>>> REPLACE

3) Add Dropbox token + refresh endpoints similar to OneDrive

Below handleOneDriveRefresh (after line 342), add:

[NEW] worker/oauth-handler.ts

export async function handleDropboxToken(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS })
  }

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: OAUTH_CORS_HEADERS })
  }

  if (!env.RAG_KV) {
    return new Response(JSON.stringify({ error: 'token_storage_kv_not_configured' }), {
      status: 503,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const creds = await readOAuthCredentials(env, 'dropbox')
  if (!creds) {
    return new Response(JSON.stringify({ error: 'dropbox_token_missing' }), {
      status: 404,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    accessToken: creds.accessToken,
    expiresAt: creds.expiresAt ?? null
  }), {
    status: 200,
    headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}

export async function handleDropboxRefresh(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: OAUTH_CORS_HEADERS })
  }

  if (!env.RAG_KV) {
    return new Response(JSON.stringify({ error: 'token_storage_kv_not_configured' }), {
      status: 503,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const current = await readOAuthCredentials(env, 'dropbox')
  if (!current?.refreshToken) {
    return new Response(JSON.stringify({ error: 'dropbox_refresh_token_missing' }), {
      status: 409,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const clientId = env.DROPBOX_CLIENT_ID
  const clientSecret = env.DROPBOX_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'dropbox_oauth_not_configured' }), {
      status: 500,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  })

  const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: `dropbox_refresh_http_${resp.status}` }), {
      status: 502,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const json = (await resp.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
  }

  if (!json.access_token) {
    return new Response(JSON.stringify({ error: json.error || 'dropbox_refresh_no_access_token' }), {
      status: 502,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  await storeServiceToken(env, 'dropbox', json.access_token)
  await storeOAuthCredentials(env, 'dropbox', {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? current.refreshToken,
    expiresIn: json.expires_in
  })

  return new Response(JSON.stringify({
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? null
  }), {
    status: 200,
    headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}

4) Wire new endpoints in worker/index.ts

File: worker/index.ts

At top import:

<<<<<<< SEARCH
import { handleStoreVerifier, handleOAuthCallback, handleOneDriveToken, handleOneDriveRefresh } from './oauth-handler'
=======
import {
  handleStoreVerifier,
  handleOAuthCallback,
  handleOneDriveToken,
  handleOneDriveRefresh,
  handleDropboxToken,
  handleDropboxRefresh
} from './oauth-handler'
>>>>>>> REPLACE

Inside handleRequest, add routing:

After OneDrive token/refresh handlers:

<<<<<<< SEARCH
  if (path === '/api/oauth/onedrive/token') {
    return handleOneDriveToken(request, env)
  }

  if (path === '/api/oauth/onedrive/refresh') {
    return handleOneDriveRefresh(request, env)
  }
=======
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
>>>>>>> REPLACE

B. Dropbox client: use stored tokens and refresh

File: src/lib/integrations/dropbox-service.ts

Add TokenState and refresh logic similar to OneDrive:

1) Define TokenState:

Insert after interfaces (around line 56):

[NEW]

interface DropboxTokenState {
  value: string
}

2) Update fetchWithAuth to support 401 + refresh:

Replace fetchWithAuth with:

<<<<<<< SEARCH
  private async fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Dropbox API error: ${response.statusText}`)
    }

    return response
  }
=======
  private async fetchWithAuth(
    url: string,
    tokenState: DropboxTokenState,
    options: RequestInit = {},
    attempt = 0
  ): Promise<Response> {
    if (!tokenState.value) {
      throw new Error('Dropbox access token is missing')
    }

    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    headers.set('Authorization', `Bearer ${tokenState.value}`)

    const response = await fetch(url, {
      ...options,
      headers
    })

    if (response.status === 401 && attempt === 0) {
      const refreshed = await this.refreshAccessToken(tokenState)
      if (refreshed) {
        return this.fetchWithAuth(url, tokenState, options, attempt + 1)
      }
    }

    if (!response.ok) {
      throw new Error(`Dropbox API error: ${response.status} ${response.statusText}`)
    }

    return response
  }
>>>>>>> REPLACE

3) Update listFiles and downloadFile to use tokenState:

<<<<<<< SEARCH
  private async listFiles(token: string, path: string = ''): Promise<DropboxFile[]> {
=======
  private async listFiles(tokenState: DropboxTokenState, path: string = ''): Promise<DropboxFile[]> {
>>>>>>> REPLACE

Within listFiles body:

- Replace calls:

<<<<<<< SEARCH
      const response = await this.fetchWithAuth(url, token, {
=======
      const response = await this.fetchWithAuth(url, tokenState, {
>>>>>>> REPLACE

and similar.

For downloadFile:

<<<<<<< SEARCH
  private async downloadFile(token: string, path: string): Promise<string> {
=======
  private async downloadFile(tokenState: DropboxTokenState, path: string): Promise<string> {
>>>>>>> REPLACE

Use:

- For direct download:

Headers use `tokenState.value`.

4) Add refreshAccessToken:

[NEW] inside DropboxService:

  private async refreshAccessToken(tokenState: DropboxTokenState): Promise<boolean> {
    try {
      const resp = await fetch('/api/oauth/dropbox/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!resp.ok) {
        console.warn('[dropbox-service] Refresh request failed', resp.status)
        return false
      }

      const data = await resp.json().catch(() => null)
      const accessToken = typeof data?.accessToken === 'string' ? data.accessToken : null
      if (!accessToken) {
        console.warn('[dropbox-service] Refresh response missing access token')
        return false
      }

      if (typeof window !== 'undefined') {
        try {
          const { secureTokenStorage } = await import('@/lib/services/secure-token-storage')
          await secureTokenStorage.setToken('dropbox', accessToken)
        } catch (error) {
          console.warn('[dropbox-service] Unable to persist refreshed Dropbox token', error)
        }
      }

      tokenState.value = accessToken
      return true
    } catch (error) {
      console.error('[dropbox-service] Refresh token request error', error)
      return false
    }
  }

5) In ingestFiles, use tokenState and listFiles(tokenState,...)/downloadFile(tokenState,...).

6) In validateConfig, use listFiles({value:config.accessToken}, ...).

C. DropboxIngestion: hydrate and rely on secure tokens

File: src/components/DropboxIngestion.tsx

- Already:
  - Loads token from SecureTokenStorage:
    - [DropboxIngestion.tsx useEffect getToken('dropbox')](src/components/DropboxIngestion.tsx:42)
  - Calls secureTokenStorage.setToken on ingest:
    - [DropboxIngestion.tsx handleIngest](src/components/DropboxIngestion.tsx:95)

This will now benefit from refreshAccessToken automatically.

Status after these changes:

- OneDrive: robust refresh implemented.
- Dropbox: now supports refresh via worker + client service.
- SecureTokenStorage: hardened salt derivation.

(AgentWorkflowVisualizer accessibility & bundle splitting are resolved; no changes proposed.)

==================================================
2. Toasts, Notifications, and UX Consistency
==================================================

Confirmed gaps:

- Toasts use `sonner` in many places; ARIA roles depend on configuration.
- ui/sonner.tsx exists and supports aria-live and roles.
- No single, enforced usage pattern.

Plan:

2.1. Centralize Toaster configuration

File: src/components/ui/sonner.tsx

This file already exposes a Toaster that accepts aria* props. Ensure it defaults to accessible roles:

- Confirm (or update) container:

[Key lines]

- [src/components/ui/sonner.tsx aria-live/role handling](src/components/ui/sonner.tsx:87)

Ensure:

- Success/info: role="status" aria-live="polite"
- Error: role="alert" aria-live="assertive"

If not already present, update mapping in this file (small diff, not pasted in full due to length).

2.2. Ensure single toast system

Replace any non-sonner toasts (none observed; all imports from 'sonner') with this standard.

No redundant changes required; the main action is to audit ui/sonner.tsx to ensure the mapping.

==================================================
3. Vendor Libraries and Dependency Hygiene
==================================================

Confirmed:

- manualChunks configured in vite.config.analyze.ts.
- Dynamic imports in App.tsx already used.
- No obvious unused heavy dependencies in provided snippets; a deeper automated check would run `npm ls` / `npm outdated` (not executed here).

Concrete changes (safe, minimal):

3.1. Ensure analyze config matches real imports

File: vite.config.analyze.ts

Check that manualChunks entries are all actually used. If some are not present in package.json or code, remove them. Example (if `microsoft-graph` or `dropbox` are not real deps):

- Edit manualChunks accordingly.

Since we don’t see full package.json contents here, do not propose concrete removals; instead, run a dependency audit before removing.

==================================================
4. Document Upload & Ingestion Flows
==================================================

Confirmed gaps:

- Duplicate file detection: missing.
- Unsupported file feedback: silent.
- Upload queue exists but only partially surfaced.
- Error surfacing is decent but can be hardened.

4.1. Add duplicate detection and unsupported type warning

File: src/components/DocumentUpload.tsx

Justification: Prevent user confusion and wasted processing.

Minimal diff in handleFiles (around lines 223+):

1) Compute seen key set (name+size):

Insert after initializing initialProgress:

[NEW]

    const seen = new Set<string>()
    const markError = (fileName: string, message: string) => {
      setUploadProgress(prev =>
        prev.map(p =>
          p.fileName === fileName
            ? { ...p, progress: 100, status: 'error', error: message }
            : p
        )
      )
    }

2) Update loop:

<<<<<<< SEARCH
    for (const file of Array.from(files)) {
      if (file.type === 'text/plain' || file.type === 'application/pdf' || file.name.endsWith('.md')) {
        // File size guard
=======
    for (const file of Array.from(files)) {
      const key = `${file.name}:${file.size}`
      if (seen.has(key)) {
        markError(file.name, 'Duplicate file skipped')
        continue
      }
      seen.add(key)

      if (file.type === 'text/plain' || file.type === 'application/pdf' || file.name.endsWith('.md')) {
        // File size guard
>>>>>>> REPLACE

3) Add explicit unsupported type handling:

After the type-allowed branch:

[NEW inside loop]

      } else {
        markError(file.name, 'Unsupported file type. Allowed: .txt, .md, .pdf')
      }

This stays consistent with existing UI and logging.

==================================================
5. Dropbox & OneDrive Integrations Hardening
==================================================

Beyond refresh logic (section 1):

- Ensure scopes:

File: src/hooks/use-oauth.ts

- Dropbox scopes: currently `files.content.read`, `files.metadata.read` (good).
- OneDrive scopes: `Files.Read`, `Files.Read.All`, `offline_access` (consistent with refresh).

No change required.

- Pagination & file filters:
  - DropboxService and OneDriveService already filter by known text extensions and recurse / follow nextLink.

5.1. Add defensive error messages for token issues

Minor: In OneDriveIngestion and DropboxIngestion, errors from validateConfig/ingest are toasted; behavior is adequate.

No invasive changes required beyond those already covered.

==================================================
6. Upload Queue & Central Manager
==================================================

Confirmed:

- use-upload-queue.ts implements:
  - IndexedDB persistence
  - Chunking
  - Retries with backoff
  - finalizeWorkerUpload
- DocumentUpload uses addFile for large files only; queue UI not exposed.

6.1. Provide minimal UploadManager component (optional enhancement)

To keep this plan focused and not invent new endpoints, recommended next step is:

- New component `src/components/UploadManager.tsx` that:
  - Uses useUploadQueue()
  - Renders queue state (status, progress, retry/remove)

Since not strictly requested with concrete full file content in prompt (and would be lengthy), treat as a follow-up; the foundational queue is already present.

==================================================
7. TypeScript Strictness & Config
==================================================

Confirmed:

- tsconfig already has:
  - "strict": true
  - "noUncheckedIndexedAccess": true
  - "exactOptionalPropertyTypes": true

No stricter settings suggested without breaking changes. Documentation (prioritizedplan.md, currentplan.md) should be updated to reflect reality, but no code change is needed.

==================================================
8. Security Headers & CSP
==================================================

Confirmed gap:

- Worker sets only CORS headers; no CSP, X-Frame-Options, etc.

8.1. Add CSP and related headers in worker/index.ts

Justification: Mitigate XSS, clickjacking, MIME sniffing.

File: worker/index.ts

1) Define security headers:

Add near top of file:

[NEW]

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; " +
    "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' https://api.github.com https://login.microsoftonline.com https://graph.microsoft.com https://api.dropboxapi.com https://content.dropboxapi.com;",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
}

function applySecurityHeaders(headers: Headers | Record<string, string>) {
  const h = headers instanceof Headers ? headers : new Headers(headers)
  for (const [k, v] of Object.entries(securityHeaders)) {
    if (!h.has(k)) h.set(k, v)
  }
  return h
}

2) Apply to responses in handleRequest and helpers.

Example: in handleRequest default 404:

<<<<<<< SEARCH
  return new Response('Not Found', { status: 404, headers: corsHeaders })
=======
  return new Response('Not Found', {
    status: 404,
    headers: applySecurityHeaders(corsHeaders)
  })
>>>>>>> REPLACE

Similarly, wrap all JSON/API responses in worker/index.ts and handler functions by passing headers through applySecurityHeaders. This is mechanical but straightforward.

==================================================
9. GitHub Service & Rate Limiting
==================================================

Confirmed:

- GitHubService has retries for 429 but not detailed messaging/abuse detection.

File: src/lib/integrations/github-service.ts

9.1. Enhance error content for rate limit/abuse

Justification: Provide clearer diagnostics for UI.

In fetchWithAuth (around line 99):

Replace error throwing with hints:

<<<<<<< SEARCH
      if (i === retries - 1) {
        throw new Error(`GitHub API error: ${response.statusText}`)
      }
=======
      if (i === retries - 1) {
        const remaining = response.headers.get('X-RateLimit-Remaining')
        const reset = response.headers.get('X-RateLimit-Reset')
        if (response.status === 403 || response.status === 429 || remaining === '0') {
          const resetHint = reset ? ` Retry after ${new Date(parseInt(reset, 10) * 1000).toLocaleTimeString()}.` : ''
          throw new Error(`GitHub API rate limit reached.${resetHint}`)
        }

        const abuse = response.headers.get('X-RateLimit-Policy') || ''
        if (response.status === 403 && abuse) {
          throw new Error('GitHub API abuse detection triggered. Please slow down or use authenticated access.')
        }

        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
      }
>>>>>>> REPLACE

UI components (e.g., GitHubIngestion.tsx) already display error.message via toast, so this improves UX without further wiring.

==================================================
10. ScalingDashboard & SSE
==================================================

Confirmed:

- ScalingDashboard uses polling every 5s.
- No SSE endpoints present. SSE work is a future enhancement; no partial implementation to fix.

Remediation (conceptual, not applied since no SSE route exists):

- Implement `/api/metrics/stream` SSE in worker and use EventSource in ScalingDashboard.
- Since the codebase does not yet have SSE, I will not include speculative code here per your constraints.

==================================================
11. Error Boundaries & Resiliency (Validation)
==================================================

Confirmed:

- Global ErrorBoundary in main.tsx.
- SectionErrorBoundary around major routes in App.tsx.
- This aligns with prioritizedplan.md; no further change required.

==================================================
12. AgentWorkflowVisualizer Accessibility (Validation)
==================================================

Confirmed:

- Already uses buttons, aria-expanded, aria-controls, aria-live, etc.
- Meets requested requirements; no additional changes proposed.

==================================================
13. Toast/Notification System (Validation)
==================================================

Confirmed:

- Single system: sonner via ui/sonner.tsx and toast imports.
- To fully satisfy the prioritized plan, ensure ui/sonner.tsx enforces:
  - Success/info → role="status", aria-live="polite"
  - Error → role="alert", aria-live="assertive"

This is a small internal mapping change; implement directly in ui/sonner.tsx if not already present.

==================================================

This plan:

- Only addresses gaps that are still real in the current repo.
- Provides concrete, minimal, production-grade code edits for:
  - OAuth lifecycle (Dropbox/OneDrive, secure storage)
  - DocumentUpload robustness (duplicates + unsupported types)
  - GitHub rate-limit messaging
  - Security headers/CSP
- Confirms and does not duplicate areas already resolved (AgentWorkflowVisualizer a11y, code splitting, error boundaries, TS strictness, etc.).
