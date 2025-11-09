# Patch Notes: worker/index.ts and DocumentUpload.tsx

This document captures the concrete fixes applied and suggested
for `worker/index.ts` and `src/components/DocumentUpload.tsx`.

## 1. worker/index.ts

### 1.1 KV GET cache placement

**Goal:** Cache only single-key GET responses and check cache
before reading from KV.

**Changes:**

- Inside `handleKVRequest`, in the `case 'GET'` branch:
  - Leave the `if (!key) { ... }` list-keys behavior unchanged.
  - Immediately after the list-keys `return`, add cache lookup
    for single-key GETs:

```ts
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
```

- Keep the existing post-read caching after `kv_get_key`:

```ts
logStructured({
  level: 'info',
  event: 'kv_get_key',
  key,
})

const response = Response.json(value, { headers: corsHeaders })

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
```

**Outcome:**

- `GET /api/kv/:key` now uses edge cache correctly.
- `GET /api/kv` (list) is never incorrectly cached by key.

---

### 1.2 Chunk upload: store real bytes with TTL

**Goal:** Ensure `/api/upload-chunk` persists actual chunk data
in KV instead of metadata-only stubs.

**Changes (in `handleUploadChunkRequest`)**:

```ts
const buf = await chunk.arrayBuffer()
const key = `upload-chunk:${documentId}:${chunkIndex.toString().padStart(6, '0')}`

// Store raw bytes with TTL so incomplete uploads eventually expire
await (env.RAG_KV as any).put(key, buf as any, { expirationTtl: 3600 })

logStructured({
  level: 'info',
  event: 'upload_chunk_saved',
  metadata: { documentId, chunkIndex, size: buf.byteLength },
})
```

**Outcome:**

- Each chunk is stored as raw bytes under a deterministic key.
- Chunks auto-expire after 1 hour if never finalized.

---

### 1.3 Add `/api/upload-complete` finalize endpoint

**Goal:** Provide a server endpoint to assemble previously
uploaded chunks into a single blob and clean up chunk keys.

**Route wiring (in `fetch`)**:

```ts
// Chunked upload endpoint
if (url.pathname === '/api/upload-chunk') {
  return handleUploadChunkRequest(request, env)
}

// Chunk assembly endpoint
if (url.pathname === '/api/upload-complete') {
  return handleUploadCompleteRequest(request, env)
}
```

**Handler implementation**:

```ts
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

    if (!documentId || !Number.isInteger(totalChunks) || (totalChunks as number) <= 0) {
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
        // Note: `merged` bytes are not returned; ingestion should be server-side.
      },
      { headers: corsHeaders },
    )
  } catch (error: unknown) {
    return new Response(getErrorMessage(error) || 'Bad Request', { status: 400, headers: corsHeaders })
  }
}
```

**Outcome:**

- Frontend can notify the worker when all chunks are uploaded.
- Worker assembles and cleans up chunks; ingestion can be added on
  top of this in a follow-up change.

---

## 2. Minimal client changes in src/components/DocumentUpload.tsx

**Goal:** After uploading chunks in Worker mode, call
`/api/upload-complete` instead of leaving chunk uploads unused,
while still relying on the existing ingestion pipeline.

### 2.1 Pre-conditions

- `runtime.isCloudflareWorkers()` is used to gate chunked uploads.
- `processContent` already handles:
  - `intelligentChunkDocument`
  - `azureServiceManager.processDocumentWithAzure`
  - `embeddingManager` + `cacheManager`

### 2.2 Update processLargeFile

Inside `processLargeFile`, after successfully uploading all
chunks, replace the local-only comment with a finalize call.

**Before:**

```ts
// NOTE: File is still read locally despite chunk uploads - see warning above
const content = await readLargeFile(file)
return await processContent(content, docId, file.name, file.size, file.type || 'text/plain', progressFn)
```

**After:**

```ts
// Notify worker to assemble chunks
const finalizeResp = await fetch('/api/upload-complete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentId: docId,
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    totalChunks,
  }),
})

if (!finalizeResp.ok) {
  const message = await finalizeResp.text().catch(() => '')
  throw new Error(
    `Failed to finalize upload: ${finalizeResp.status} ${finalizeResp.statusText}` +
    (message ? ` - ${message}` : ''),
  )
}

// For now, still read locally so ingestion uses existing pipeline.
// This keeps behavior stable while exercising the worker endpoint.
const content = await readLargeFile(file)
return await processContent(
  content,
  docId,
  file.name,
  file.size,
  file.type || 'text/plain',
  progressFn,
)
```

**Outcome:**

- Large-file flow in Worker mode:
  1. Uploads chunks (`/api/upload-chunk`).
  2. Calls `/api/upload-complete` to assemble + cleanup.
  3. Still uses existing client-side ingestion for the
     actual document processing (no behavior regression).

- This keeps the implementation minimal and backward-compatible,
  while making server-side chunk handling real and testable.

