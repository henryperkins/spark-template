# Cloudflare Runtime Smoke Test

Run this quick manual checklist after deploying or starting `wrangler dev`.

- KV
  - Confirm `/api/kv` works: set, get, list, delete
    - Browser app persists and reads keys (e.g., cache and query history)
    - `KV_API_KEY` secret is set; 401s appear when invalid
  - Namespace managers (namespaces, embeddings) store/read metadata

- LLM Proxy
  - With Azure disabled, app can generate answers via Worker stub
    - Expected: deterministic “Stubbed worker response …” text
  - With Azure enabled, answers come from Azure path
    - Token tracker provider label shows `azure`
  - With Azure disabled, provider label shows `worker`

- Telemetry
  - Set `VITE_ANALYTICS_ENDPOINT=/api/telemetry` in client env
  - Trigger a query; ensure POSTs to `/api/telemetry` succeed (204s)
  - Check Wrangler logs for `client_telemetry` events

- Agent Analytics
  - Trigger a long-running step; confirm in‑app toast
  - Verify system alerts persisted under `system-alerts` in KV

- Query History
  - Run a few queries; check entries appear in the Search Debugger
  - Clear history; verify deletion from KV

- Cache Manager
  - Execute a repeated query; hit rate increases
  - Invalidate by prefix; confirm entries removed

- Worker Routes
  - `/api/kv` responds and requires `Authorization: Bearer <KV_API_KEY>` when sent
  - `/api/llm` returns `{ text: ... }`
  - `/api/telemetry` accepts events and returns 204

Post‑deploy
- Watch Cloudflare logs for unexpected 404s on `/api/llm` or `/api/telemetry`
- Tune CORS allowed origins as needed in `worker/index.ts`

