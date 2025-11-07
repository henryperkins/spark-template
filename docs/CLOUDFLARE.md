# Cloudflare Workers Architecture & Migration Guide

This document explains the architecture, migration strategy, and advanced features of deploying the Agentic RAG application to Cloudflare Workers.

> **🚀 For quick deployment instructions, see [../CLOUDFLARE.md](../CLOUDFLARE.md)**

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Runtime Detection](#runtime-detection)
3. [Storage Hierarchy](#storage-hierarchy)
4. [Migration from Spark](#migration-from-spark)
5. [Worker Implementation](#worker-implementation)
6. [Monitoring & Debugging](#monitoring--debugging)
7. [Advanced Topics](#advanced-topics)

---

## Architecture Overview

The application uses a **hybrid runtime** approach with automatic fallbacks for maximum flexibility across development and production environments.

### Storage Hierarchy (Automatic Detection)

```
Priority 1: Cloudflare KV (Worker or REST API)
    ↓ (if not configured)
Priority 2: localStorage (development fallback)
```

### LLM Hierarchy (Automatic Detection)

```
Priority 1: Azure OpenAI (production)
    ↓ (if not configured)
Priority 2: Mock responses (development fallback)
```

### Platform Integration

The app uses a **hybrid runtime** with automatic detection:

**Storage (Priority Order)**:
1. **Cloudflare KV** (Worker binding or REST API) - Production storage
2. **localStorage** - Development fallback

**LLM (Priority Order)**:
1. **Azure OpenAI** - Primary production LLM provider
2. **Mock responses** - Development fallback when Azure not configured

**Runtime Detection**:
The `runtime` utility (src/lib/config.ts) automatically detects:
- Cloudflare Workers deployment (`.workers.dev` domain)
- Cloudflare KV configuration (environment variables)
- Azure OpenAI configuration

---

## Runtime Detection

The application automatically detects the runtime environment using the `runtime` utility:

```typescript
import { runtime } from '@/lib/config'

// Check platform
runtime.isCloudflareWorkers()        // true if on .workers.dev
runtime.isCloudflareKVConfigured()   // true if env vars set
runtime.isAzureConfigured()          // true if Azure credentials set

// Get current storage mode
runtime.getStorageMode()             // 'cloudflare' | 'local'

// Get environment name for logging
runtime.getEnvironmentName()         // 'cloudflare-production' | 'development-cloudflare' | 'development-local'
```

### Detection Logic

**File:** `src/lib/config.ts`

```typescript
// Detects Cloudflare Workers environment
function isCloudflareWorkers(): boolean {
  return typeof window !== 'undefined' &&
         window.location.hostname.includes('.workers.dev')
}

// Detects Cloudflare KV REST API configuration
function isCloudflareKVConfigured(): boolean {
  return !!(
    import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID &&
    import.meta.env.VITE_CLOUDFLARE_KV_NAMESPACE_ID &&
    import.meta.env.VITE_CLOUDFLARE_API_TOKEN
  )
}

// Determines storage mode
function getStorageMode(): 'cloudflare' | 'local' {
  return isCloudflareWorkers() || isCloudflareKVConfigured()
    ? 'cloudflare'
    : 'local'
}
```

---

## Storage Hierarchy

### 1. Cloudflare Workers (Production)

**When:** App is deployed to `.workers.dev` domain
**Storage:** Direct KV binding via Worker API
**Endpoint:** `/api/kv`
**Advantages:**
- ✅ Direct binding (no REST API overhead)
- ✅ Lowest latency
- ✅ No API tokens needed
- ✅ 25MB per value limit

**Architecture:**
```
React App (agentic-rag.workers.dev)
    ↓
Worker API Endpoint: /api/kv
    ↓
env.RAG_KV (Direct KV Binding)
    ↓
Cloudflare KV Namespace
```

### 2. Cloudflare KV REST API (Local Development)

**When:** Local dev with environment variables configured
**Storage:** REST API to Cloudflare
**Endpoint:** `https://api.cloudflare.com/client/v4/...`
**Advantages:**
- ✅ Production-like storage in development
- ✅ No need to deploy for testing
- ✅ 25MB per value limit

**Architecture:**
```
React App (localhost:5000)
    ↓
Cloudflare KV Client (src/lib/cloudflare-kv.ts)
    ↓
https://api.cloudflare.com/client/v4/accounts/{account}/storage/kv/namespaces/{namespace}/values/{key}
    ↓
Cloudflare KV Namespace
```

**Required Environment Variables:**
```bash
VITE_CLOUDFLARE_ACCOUNT_ID=your_account_id
VITE_CLOUDFLARE_KV_NAMESPACE_ID=your_namespace_id
VITE_CLOUDFLARE_API_TOKEN=your_api_token
```

### 3. localStorage (Fallback)

**When:** No Cloudflare configuration
**Storage:** Browser localStorage
**Advantages:**
- ✅ Zero configuration
- ✅ Works offline
- ⚠️ 5-10MB limit (browser dependent)
- ⚠️ No cross-device sync

**Architecture:**
```
React App (localhost:5000)
    ↓
localStorage API
    ↓
Browser Storage
```

---

## Migration from Spark

The application was originally built for GitHub Spark and has been migrated to Cloudflare Workers while maintaining backward compatibility.

### Current State

✅ **Fully Migrated to Cloudflare:**
- **KV Storage**: `useSparkKV` hook auto-detects Cloudflare KV
- **Worker API**: `/api/kv` endpoint functional
- **Logs API**: `/api/logs` endpoint for R2 Logpush access
- **Auto-detection**: Checks for `.workers.dev` domain or env vars

### Spark Compatibility Layer

The `spark-fallback.ts` module intercepts legacy `/_spark/*` calls and provides:
- Automatic Cloudflare KV routing when available
- localStorage fallback for local development
- Mock LLM responses when Azure isn't configured

**File:** `src/lib/spark-fallback.ts`

### State Management Pattern

The `useSparkKV` hook (`src/hooks/use-spark-kv.ts`) is the primary state management mechanism:
- Automatically syncs state to Cloudflare KV or localStorage fallback
- Auto-detects runtime environment and selects appropriate storage
- Returns `[value, setter, deleter]` tuple similar to useState
- Use for all persistent application state (documents, config, etc.)

**Example:**
```typescript
const [documents, setDocuments] = useSparkKV<Document[]>('rag-documents', [])
```

---

## Worker Implementation

### File Structure

```
spark-template/
├── worker/
│   └── index.ts          # Cloudflare Worker entry point
├── wrangler.toml         # Cloudflare configuration
├── src/
│   └── lib/
│       ├── cloudflare-kv.ts      # KV client (REST + Worker API)
│       ├── spark-fallback.ts     # Storage fallback logic
│       └── config.ts             # Runtime detection
└── .env                  # Local credentials (git-ignored)
```

### Worker Entry Point

**File:** `worker/index.ts`

The Worker serves three purposes:

1. **Static Asset Serving** - Serves the React SPA from `dist/`
2. **KV API** - Provides `/api/kv` endpoints for data persistence
3. **Logs API** - Provides `/api/logs` for R2 Logpush access

**KV API Endpoints:**

```typescript
// List all keys
GET /api/kv

// Get a value
GET /api/kv/:key

// Set a value
PUT /api/kv/:key
Body: { value: any }

// Delete a value
DELETE /api/kv/:key
```

### Worker Bindings

Your worker has access to these Cloudflare resources:

1. **KV Namespace** (`RAG_KV`) - For application data storage
   - Documents, configuration, cache
   - Access via `/api/kv` endpoint

2. **R2 Bucket** (`LOGS`) - For Logpush logs
   - Logs from `cloudflare-managed-17bd49a0` bucket
   - Access via `/api/logs` endpoint
   - Automatic log aggregation from Logpush job

3. **Assets** (`ASSETS`) - For serving the React SPA
   - Serves files from `dist/` directory

### Structured Logging

Your worker uses **structured JSON logging** for better analytics and debugging. Each log entry includes:

**Custom Log Fields** (from worker code):
- `timestamp` - ISO 8601 timestamp
- `level` - "info", "warn", "error", or "debug"
- `event` - Event type (e.g., "kv_api_request", "kv_put_key")
- `method` - HTTP method
- `path` - Request path
- `key` - KV key (for KV operations)
- `statusCode` - Response status code
- `duration` - Request duration in milliseconds
- `error` - Error message (if applicable)
- `metadata` - Additional context (size, count, etc.)

**Cloudflare Logpush Fields** (automatically added):
- `outcome` - "ok", "exception", "exceededCpu", etc.
- `scriptName` - Worker name ("agentic-rag")
- `logs` - Array of console.log outputs (contains your structured logs)
- `exceptions` - Error details and stack traces
- `cpuTime` - CPU execution time in milliseconds
- `event` - Full request details (method, url, headers)

---

## Monitoring & Debugging

### Real-time Logs

```bash
npm run cf:tail
```

View live Worker logs as requests are processed.

### Logpush (Persistent Logs)

Logpush is enabled in `wrangler.toml` and sends Worker logs to R2 storage for historical analysis.

**Current Setup:**
- **Logpush Job**: `cloudflare-managed-17bd49a0`
- **R2 Bucket**: `cloudflare-managed-17bd49a0`

**View Logpush Job Status:**
```bash
# List all Logpush jobs
npx wrangler logpush list

# Get specific job details
npx wrangler logpush get cloudflare-managed-17bd49a0
```

**Access Log Files in R2:**
```bash
# List log files in R2 bucket
npx wrangler r2 object list cloudflare-managed-17bd49a0

# Download a specific log file
npx wrangler r2 object get cloudflare-managed-17bd49a0/path/to/log.json --file=log.json
```

### Programmatic Log Access

Your worker provides a `/api/logs` endpoint to access logs programmatically:

**List recent log files:**
```bash
curl https://your-worker.workers.dev/api/logs?action=list&limit=10
```

**Get specific log file:**
```bash
curl https://your-worker.workers.dev/api/logs?action=get&key=path/to/log.json
```

**Get most recent log entries:**
```bash
curl https://your-worker.workers.dev/api/logs?action=recent&limit=100
```

### Example Log Entry

When you access the KV API, a structured log is created:

```json
{
  "timestamp": "2025-11-02T14:30:45.123Z",
  "level": "info",
  "event": "kv_api_request",
  "method": "POST",
  "path": "/api/kv/rag-documents",
  "statusCode": 200,
  "duration": 45
}
```

### Log Event Types

- `kv_api_request` - KV API request completed
- `kv_list_keys` - Listed all KV keys
- `kv_get_key` - Retrieved a KV key
- `kv_put_key` - Stored a KV key
- `kv_delete_key` - Deleted a KV key
- `kv_key_not_found` - KV key not found
- `kv_operation_error` - KV operation failed
- `logs_list_files` - Listed log files
- `logs_get_file` - Retrieved log file
- `logs_get_recent` - Retrieved recent logs
- `logs_api_error` - Logs API error
- `asset_request` - Asset request (debug level)
- `request_error` - Request error

### Check Deployment Status

```bash
npx wrangler deployments list
```

### View KV Data

```bash
# List all keys
npx wrangler kv:key list --binding RAG_KV

# Get a specific key
npx wrangler kv:key get "rag-documents" --binding RAG_KV

# Put a key (testing)
npx wrangler kv:key put "test-key" "test-value" --binding RAG_KV

# Delete a key
npx wrangler kv:key delete "test-key" --binding RAG_KV
```

---

## Advanced Topics

### Custom Domains

1. Go to Cloudflare Dashboard
2. Navigate to Workers & Pages > your-worker
3. Click "Custom Domains"
4. Add your domain

### Environment Variables vs Secrets

**Environment Variables** (wrangler.toml `[vars]`):
- Non-sensitive configuration
- Visible in code
- Example: `VITE_APP_ENV = "production"`

**Secrets** (via `wrangler secret put`):
- Sensitive credentials
- Encrypted at rest
- Never visible in logs
- Examples: API keys, tokens

```bash
npx wrangler secret put VITE_AZURE_OPENAI_KEY
npx wrangler secret put VITE_AZURE_SEARCH_KEY
```

### Multiple Environments

**wrangler.toml** supports environment-specific configuration:

```toml
[env.staging]
name = "agentic-rag-staging"
vars = { VITE_APP_ENV = "staging" }

[env.production]
name = "agentic-rag"
vars = { VITE_APP_ENV = "production" }
```

Deploy to specific environment:
```bash
npm run cf:deploy:staging
npm run cf:deploy:production
```

### Performance Optimization

**KV Best Practices:**
- Keep values under 25MB (hard limit)
- Use namespacing for multitenancy
- Cache frequently accessed keys
- Batch operations when possible

**Worker Best Practices:**
- Minimize CPU time (10ms free tier limit)
- Use streaming for large responses
- Leverage edge caching
- Monitor execution time in logs

### Security

**Built-in Security:**
- ✅ TLS/HTTPS by default
- ✅ DDoS protection via Cloudflare
- ✅ Automatic certificate management
- ✅ Worker isolation

**Best Practices:**
- Use secrets for all sensitive data
- Implement rate limiting
- Validate all inputs
- Use CORS headers appropriately

---

## Troubleshooting

### "Using localStorage" when Cloudflare KV is configured

1. Check console for error messages
2. Verify environment variables are set correctly
3. Refresh the page to re-run auto-detection
4. Check Network tab for `/api/kv` requests

### "Mock LLM responses" when Azure is configured

1. Open Azure tab and verify credentials are saved
2. Check console for Azure connection errors
3. Verify Azure OpenAI endpoint and key are correct
4. Test connection in Azure tab

### KV operations timing out

1. Check Cloudflare Worker logs: `npm run cf:tail`
2. Verify KV namespace is created and bound
3. Check Worker deployment status
4. Review worker error logs in Cloudflare dashboard

### Build failures

```bash
# Clear cache
rm -rf node_modules/.vite dist

# Rebuild
npm install
npm run build
```

---

## Cost Estimates

### Cloudflare Workers Free Tier

- ✅ 100,000 requests/day
- ✅ KV: 100,000 reads/day, 1,000 writes/day
- ✅ CPU: 10ms per request

### Azure OpenAI (Pay-as-you-go)

- GPT-4o-mini: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- Typical query with 5 documents: ~10K tokens = $0.01 per query
- 1,000 queries/month ≈ $10

---

## Support & Resources

- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **KV Documentation**: https://developers.cloudflare.com/kv/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **React + Vite Guide**: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- **Logpush Docs**: https://developers.cloudflare.com/logs/get-started/enable-destinations/r2/
- **R2 Storage**: https://developers.cloudflare.com/r2/
