# Worker Log Analysis Utility

Comprehensive CLI tool for querying, filtering, and analyzing Cloudflare Worker logs.

## Quick Start

```bash
# Show help
npm run logs

# Watch logs in real-time (no setup required)
npm run logs:watch

# Analyze performance
npm run logs:perf

# Show errors only
npm run logs:errors
```

## Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `npm run logs` | Show help menu | - |
| `npm run logs:watch` | Real-time log streaming | Uses `wrangler tail` |
| `npm run logs:recent` | Show 100 recent logs | From R2 via worker API |
| `npm run logs:analyze` | Full statistical analysis | Event distribution, performance, status codes |
| `npm run logs:errors` | Show only error logs | Filters by level=error or statusCode>=400 |
| `npm run logs:perf` | Performance analysis | Identifies slow requests (>1s) |

## Features

### 1. Real-Time Log Streaming

```bash
npm run logs:watch
```

- ✅ No API key required
- ✅ Uses `wrangler tail` under the hood
- ✅ Pretty-printed, colored output
- ✅ Streams live requests as they happen

**Sample Output:**
```
👀 Watching logs in real-time...
12:30:45 INFO  kv_api_request GET /api/kv/llm-usage-metrics (95ms) 200
12:30:46 INFO  kv_get_key llm-usage-metrics
```

### 2. Recent Logs (API Mode)

```bash
npm run logs:recent     # Default: 100 logs
```

Requires `LOGS_API_KEY` environment variable (see setup below).

**Features:**
- Fetches from R2 bucket via worker `/api/logs` endpoint
- Structured log parsing
- Color-coded by level (info/warn/error/debug)
- Shows timestamps, events, duration, status codes

### 3. Statistical Analysis

```bash
npm run logs:analyze
```

Provides comprehensive analytics:

**📌 Event Distribution** - Bar chart showing most common events
```
kv_api_request              ██████████████████████ 45
kv_get_key                  ████████████ 23
kv_health_check             ████ 8
```

**📊 Log Levels** - Breakdown by severity
```
INFO      150
WARN      3
ERROR     0
```

**⏱️ Performance Metrics** - Percentiles and latency stats
```
Min:     12.50ms
P50:     95.30ms
Average: 142.75ms
P95:     450.20ms
P99:     825.10ms
Max:     2805.00ms
```

**📈 Status Codes** - HTTP response distribution
```
200       140
201       5
404       3
503       2
```

### 4. Error Analysis

```bash
npm run logs:errors
```

Filters and displays only:
- Logs with `level: 'error'`
- Requests with `statusCode >= 400`

**Example Output:**
```
🚨 Fetching error logs...

❌ Found 3 errors:

12:15:20 ERROR kv_operation_error DELETE rag-documents (50ms) 500
  {"message": "Key delete failed", "code": "KV_ERROR"}

12:16:45 WARN  kv_auth_failed GET /api/kv/azure-config (20ms) 401
```

### 5. Performance Analysis

```bash
npm run logs:perf
```

Identifies slow requests and performance bottlenecks:

**Slow Requests (>1s):**
```
⚠️  Found 2 slow requests (>1s):

1. 2.81s - kv_api_request
   GET /api/kv/rag-documents 200
   11/8/2025, 11:29:20 AM

2. 1.25s - azure_search_proxy
   POST /api/azure-search/search 200
   11/8/2025, 11:28:15 AM
```

**Top 5 Slowest (even if <1s):**
```
📊 Top 5 slowest requests:
  1. 573ms - kv_api_request /api/kv/rag-documents
  2. 312ms - kv_api_request /api/azure-search/search
  3. 240ms - kv_api_request /api/kv/query-history
  4. 113ms - kv_api_request /api/kv/azure-config
  5. 97ms - kv_api_request /api/kv/llm-usage-metrics
```

## Setup

### Option 1: Wrangler Tail (Recommended for quick start)

**No setup required!** Just run:

```bash
npm run logs:watch
```

Requirements:
- Wrangler CLI installed ✅ (already installed)
- Cloudflare authenticated ✅ (via `CLOUDFLARE_API_TOKEN`)

### Option 2: API Access (For programmatic analysis)

1. **Get the LOGS_API_KEY** from Cloudflare Worker secrets:

```bash
# The key is already set in worker secrets
# You need to retrieve it or set it locally
wrangler secret list  # Check if LOGS_API_KEY exists
```

2. **Set environment variable:**

```bash
export LOGS_API_KEY="your-secret-key-here"
```

3. **Verify access:**

```bash
npm run logs:recent
```

If you see `⚠️ LOGS_API_KEY environment variable not set`, the utility will fall back to `wrangler tail`.

## Architecture

### Log Sources

```
┌─────────────────────────────────────┐
│  Cloudflare Worker (agentic-rag)    │
│                                     │
│  • Structured logging (logStructured)│
│  • 23 log points across endpoints   │
│  • JSON format with metadata        │
└──────────────┬──────────────────────┘
               │
               │ Logpush
               ▼
┌──────────────────────────────────────┐
│  R2 Bucket (cloudflare-managed-*)    │
│                                      │
│  • Persistent log storage            │
│  • NDJSON format (newline-delimited)│
│  • Accessible via worker API         │
└──────────────┬───────────────────────┘
               │
               │ /api/logs endpoint
               ▼
┌──────────────────────────────────────┐
│  Log Analysis Utility (this script)  │
│                                      │
│  • Fetches via HTTPS                 │
│  • Parses and filters                │
│  • Statistical analysis              │
│  • Pretty-printed output             │
└──────────────────────────────────────┘
```

### Worker `/api/logs` Endpoints

The worker (worker/index.ts:815-948) provides:

**1. List Log Files**
```bash
GET /api/logs?action=list&limit=10
Authorization: Bearer <LOGS_API_KEY>
```

**2. Get Specific Log File**
```bash
GET /api/logs?action=get&key=<log-file-key>
Authorization: Bearer <LOGS_API_KEY>
```

**3. Get Recent Logs**
```bash
GET /api/logs?action=recent&limit=100
Authorization: Bearer <LOGS_API_KEY>
```

## Log Format

### Structured Logs

All worker logs use this format (see worker/index.ts:63-74):

```typescript
interface LogEntry {
  timestamp: string        // ISO 8601 timestamp
  level: 'info' | 'warn' | 'error' | 'debug'
  event: string           // Event identifier (e.g., 'kv_api_request')
  method?: string         // HTTP method
  path?: string           // Request path
  key?: string            // KV key being accessed
  statusCode?: number     // HTTP response code
  duration?: number       // Request duration in ms
  error?: string          // Error message if applicable
  metadata?: Record<string, unknown>  // Additional data
}
```

### Event Types

Common events you'll see in logs:

| Event | Description | Typical Duration |
|-------|-------------|-----------------|
| `kv_api_request` | KV endpoint request | 95-2805ms |
| `kv_get_key` | KV read operation | 95-240ms |
| `kv_put_key` | KV write operation | 100-300ms |
| `kv_delete_key` | KV delete operation | 50-150ms |
| `kv_list_keys` | KV list operation | 100-200ms |
| `kv_health_check` | Health check request | 20-50ms |
| `azure_search_proxy_error` | Azure search failure | varies |
| `client_telemetry` | Client-side telemetry | minimal |

## Troubleshooting

### Issue: "LOGS_API_KEY environment variable not set"

**Solution 1:** Use wrangler tail (no API key needed)
```bash
npm run logs:watch
```

**Solution 2:** Set the API key
```bash
export LOGS_API_KEY="your-key"
npm run logs:recent
```

### Issue: "HTTP 401: Unauthorized"

The `LOGS_API_KEY` is incorrect or expired.

**Fix:**
1. Check worker secrets: `wrangler secret list`
2. Update if needed: `wrangler secret put LOGS_API_KEY`
3. Update your local environment variable

### Issue: "No logs found"

- **Possible causes:**
  - R2 bucket is empty (no traffic yet)
  - Logpush hasn't written files yet (can take a few minutes)
  - Worker isn't receiving traffic

**Fix:**
1. Generate some traffic: visit https://paradigmfind.com
2. Wait 2-3 minutes for Logpush to write to R2
3. Try again: `npm run logs:recent`

### Issue: Wrangler tail shows "Connected... waiting for logs"

This is normal! It means:
- ✅ Successfully connected to worker
- ⏳ Waiting for new requests
- The worker isn't receiving traffic at the moment

**Generate traffic** to see logs appear:
```bash
# In another terminal
curl https://paradigmfind.com/api/kv/health
```

## Advanced Usage

### Custom Limit

```bash
# Get 500 most recent logs
npm run logs:recent -- 500

# Analyze 2000 logs
npm run logs:analyze -- 2000

# Show 100 errors
npm run logs:errors -- 100
```

### Environment Variables

```bash
# Custom worker URL
export WORKER_URL="https://your-custom-domain.com"

# API key for /api/logs
export LOGS_API_KEY="your-secret-key"

# Then run commands
npm run logs:analyze
```

### Programmatic Usage

```javascript
const { analyzeLogs, getRecentLogs } = require('./scripts/analyze-logs.cjs')

// Get logs programmatically
const logs = await getRecentLogs(100)

// Run analysis
await analyzeLogs(1000)
```

## Performance Insights

Based on current production logs:

### Fastest Operations
- `kv_health_check`: ~20-50ms
- `kv_get_key` (small keys): ~95-113ms
- `azure_search_proxy`: ~312ms

### Slowest Operations
- `kv_get_key` (rag-documents): **2.8s** ⚠️
  - **Cause**: Large document payload (2MB+)
  - **Recommendation**: Implement pagination or lazy loading

### Typical Request Flow
```
Total: ~500-800ms

1. KV Config Read         (100ms)
2. KV Documents Read      (573ms) ← Bottleneck!
3. Azure Search Query     (312ms)
4. Response Serialization (50ms)
```

## Security

### Authorization

- `/api/logs` endpoint requires **Bearer token** authentication
- Token is stored as Cloudflare Worker secret `LOGS_API_KEY`
- Never commit tokens to git
- Rotate keys periodically

### CORS

Logs API restricts access to:
- `https://paradigmfind.com`
- `http://localhost:5173` (dev)
- `http://127.0.0.1:5173` (dev)

See `ALLOWED_ORIGINS` in worker/index.ts:92-100

## References

- Worker source: `worker/index.ts`
- Log structure: `worker/index.ts:63-74`
- Logs endpoint: `worker/index.ts:815-948`
- Wrangler config: `wrangler.toml`
- R2 bucket: `cloudflare-managed-17bd49a0`
