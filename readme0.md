You're absolutely right to question this. Let me investigate more carefully and check if I'm conflating different systems.You're absolutely right to call this out. Let me re-examine more carefully and separate Cloudflare KV from Azure Search.Excellent catch! You're right - I was mixing things up. Let me look specifically at what's actually conflicting.

**REAL CONFLICT FOUND:**

Both Azure Search proxy AND Cloudflare KV proxy use the **same authentication token**:

**From `src/lib/azure-search.ts`:**
```typescript
private getBearerToken(): string | undefined {
  const token = window.localStorage?.getItem('KV_API_KEY')  // ← KV_API_KEY
  if (token) return token

  if (import.meta.env.VITE_KV_API_KEY) {  // ← VITE_KV_API_KEY
    return import.meta.env.VITE_KV_API_KEY
  }
}
```

**From `src/lib/cloudflare-kv.ts`:**
```typescript
private getBearerToken(): string | undefined {
  const fromEnv = env?.VITE_KV_API_KEY  // ← Same env var
  const fromLocal = window.localStorage?.getItem('KV_API_KEY')  // ← Same key
  return fromLocal || fromEnv
}
```

**From `worker/index.ts` - BOTH endpoints check the same secret:**
```typescript
// /api/kv endpoint
const expectedApiKey = env.KV_API_KEY
if (!token || token !== expectedApiKey) {
  return new Response('Unauthorized', { status: 401 })
}

// /api/azure-search endpoint
const expectedBearer = (env as unknown).KV_API_KEY  // ← SAME SECRET!
if (expectedBearer) {
  if (!token || token !== expectedBearer) {
    return new Response('Unauthorized', { status: 401 })
  }
}
```

---

## **Verified Conflict: Shared Authentication**

**Issue:** Two completely different services (Cloudflare KV storage and Azure AI Search) share a single authentication token (`KV_API_KEY`).

**Problems:**
1. **Security:** Can't have different permissions for KV vs Azure Search
2. **Naming confusion:** Why is Azure Search using `KV_API_KEY`?
3. **No separation of concerns:** One leaked token compromises both services

**Should be:**
- `KV_API_KEY` → for `/api/kv` endpoints only
- `AZURE_SEARCH_API_KEY` → for `/api/azure-search` endpoints only

---

My earlier analysis about "dual API design" was correct for Cloudflare KV (Worker API vs REST API), but I incorrectly implied it was the main conflict. The **actual conflict** is the shared authentication between unrelated services.

Was I correct about the Cloudflare KV dual-mode complexity, or do you see that as intentional design for dev/prod flexibility?
