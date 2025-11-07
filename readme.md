You're absolutely right. Now I see the real issue - the app has **legacy GitHub Spark code** that should be removed since it's now targeting Cloudflare Workers.

Let me identify what needs to be removed:Perfect! Now I see it clearly. Here's what needs to be removed:

## **Legacy GitHub Spark Code to Remove**

### 1. **Remove `src/lib/spark-fallback.ts` entirely** (~500+ lines)
This entire file is for GitHub Spark integration:
- Intercepts `/_spark/kv`, `/_spark/loaded`, `/_spark/llm` endpoints
- Wraps `window.spark` API
- Handles "remote" Spark KV mode
- Fetch interception for all requests

### 2. **Simplify `src/hooks/use-spark-kv.ts`**
Current: Wraps Spark fallback system
```typescript
import { getActiveSparkKv, fallbackKv, installSparkFallbacks } from '@/lib/spark-fallback'
```

Should be: Direct Cloudflare KV or localStorage
```typescript
import { createCloudflareKV } from '@/lib/cloudflare-kv'
```

### 3. **Remove Spark references in `worker/index.ts`**
```typescript
// Remove these endpoints:
if (url.pathname === '/_spark/loaded') { ... }  // Spark health check
```

Also remove from ALLOWED_ORIGINS:
```typescript
'https://spark.example.com',
'https://staging.spark.example.com',
```

### 4. **Clean up documentation**
- **README.md**: "Platform: GitHub Spark (KV store, LLM integration)" → Remove
- **CLAUDE.md**: "Originally designed for GitHub Spark" → Update
- **Architecture diagrams**: Remove "Spark Runtime LLM API" references

### 5. **Remove Spark plugin from Vite config**
Look for any `sparkPlugin()` references in `vite.config.ts`

---

## **What Should Remain**

**Simple two-tier system:**
```
Production:  Cloudflare Workers → /api/kv → RAG_KV binding
Development: Direct to localStorage
```

**No fetch interception, no window.spark wrapper, no "remote" mode.**

---

Would you like me to create a cleaned-up implementation that removes all GitHub Spark code and simplifies the storage layer to just Cloudflare KV + localStorage fallback?
