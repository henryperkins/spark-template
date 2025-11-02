# Cloudflare KV Migration Runbook

This runbook describes a safe, incremental, one-shot migration from a legacy KV namespace (e.g., previous Spark KV bridge or older CF KV) into the new RAG_KV namespace used by the application.

References:
- Worker endpoint and handler: [handleMigrationRequest()](worker/index.ts:386)
- KV API (list/get/put/delete): [handleKVRequest()](worker/index.ts:146)
- Logs API for observability: [handleLogsRequest()](worker/index.ts:257)
- Worker config and bindings: [wrangler.toml](wrangler.toml:1)
- Frontend Cloudflare KV adapter (client): [cloudflare-kv.ts](src/lib/cloudflare-kv.ts:1)

## 1) Preconditions

1. Worker built and deployed to Cloudflare Workers, with assets served from dist
2. Production KV namespace configured and bound as RAG_KV (binding must match Env.RAG_KV):
   - Confirm in [wrangler.toml](wrangler.toml:31)
3. Optional legacy namespace configured (only if you are migrating from an older store):
   - Add (or uncomment) the optional LEGACY_KV binding in [wrangler.toml](wrangler.toml:37)
   - Sample:
     ```
     [[kv_namespaces]]
     binding = "LEGACY_KV"
     id = "legacy-production-kv-namespace-id"
     preview_id = "legacy-preview-kv-namespace-id"
     ```
4. Secrets created:
   - MIGRATION_KEY (used to authorize /api/migrate)
   - LOGS_API_KEY (used to authorize /api/logs)
   - Commands (run after deploy):
     ```
     npx wrangler secret put MIGRATION_KEY
     npx wrangler secret put LOGS_API_KEY
     ```
   - See guidance comments in [wrangler.toml](wrangler.toml:41)

5. CORS: The migration endpoint is CORS-gated and Bearer-protected. By default only:
   - https://spark.example.com
   - https://staging.spark.example.com
   are allowed (adjustable in [worker/index.ts](worker/index.ts:44)).

## 2) Migration Endpoint Summary

- Path: POST /api/migrate
- Auth: Authorization: Bearer <MIGRATION_KEY>
- Body (JSON):
  ```
  {
    "prefix": string = "",    // optional key prefix filter
    "limit": number = 0,      // optional per-invocation cap (0 = unlimited)
    "dryRun": boolean = false // when true, reads-only, reports counts, no writes
  }
  ```
- Behavior:
  - Lists keys from LEGACY_KV in pages
  - Reads value for each key; if present, writes to RAG_KV unless dryRun = true
  - Tracks scanned, copied, skipped, errors
  - Supports prefix & limit to batch migration into smaller chunks for safety and CPU time

Implementation reference: [handleMigrationRequest()](worker/index.ts:386)

## 3) Dry-Run and Planning

Always start with a dry run:

Example:
```
export WORKER_URL="https://your-worker.workers.dev"
export MIGRATION_KEY="<redacted>"

curl -sS -X POST "$WORKER_URL/api/migrate" \
  -H "Authorization: Bearer $MIGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"rag-","limit":100,"dryRun":true}'
```

Interpretation:
- scanned: number of keys discovered (up to limit)
- copied: should be 0 in dryRun
- skipped: includes keys with null content or read errors
- errorCount/errors: any read/write issues that would require attention

Plan batches by prefix and limit to fit Worker execution constraints. Prefer multiple small invocations (e.g., limit 500–2000) rather than one large request.

## 4) Execute Incremental Batches

Run repeated invocations with dryRun=false:

```
curl -sS -X POST "$WORKER_URL/api/migrate" \
  -H "Authorization: Bearer $MIGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"rag-","limit":1000,"dryRun":false}'
```

Repeat until the total scanned count matches the legacy key count for the target prefix (see Section 5 for ways to list/count keys).

Notes:
- If migrating a large namespace, do it in well-defined prefixes (e.g., rag-documents:, azure-config, cache:, etc.)
- Adjust limit downward if you hit CPU/memory limits or tail logs show slow processing
- You can resume safely; already-copied keys will be overwritten with identical content, which is harmless

## 5) Listing and Validating Keys

Options to list/validate:

A) Using Worker KV API (GET /api/kv)
- GET /api/kv returns the list of all keys (JSON array) from RAG_KV
- GET /api/kv/<key> returns the JSON value (404 if not found)
- Reference: [handleKVRequest()](worker/index.ts:146)

B) Using Wrangler CLI (server-side)
- List legacy keys:
  ```
  npx wrangler kv:key list --binding LEGACY_KV
  ```
- List new keys:
  ```
  npx wrangler kv:key list --binding RAG_KV
  ```
- Get a specific key:
  ```
  npx wrangler kv:key get "rag-documents" --binding RAG_KV
  ```

C) Sample one-off validation (curl)
```
# Verify target exists in RAG_KV via Worker HTTP (assuming same-origin or CORS allowed)
curl -sS "$WORKER_URL/api/kv/rag-documents" | jq .
```

## 6) Observability and Logs

- Structured logs: The Worker emits migration events:
  - kv_migration
  - kv_migration_error
  - See [handleMigrationRequest()](worker/index.ts:386) for log shapes
- Tail logs in real-time:
  ```
  npm run cf:tail
  ```
- Historical log access via R2 (Logpush) using /api/logs (Bearer protected by LOGS_API_KEY):
  - List recent log files:
    ```
    curl -sS "$WORKER_URL/api/logs?action=list" \
      -H "Authorization: Bearer $LOGS_API_KEY"
    ```
  - Get the most recent entries:
    ```
    curl -sS "$WORKER_URL/api/logs?action=recent&limit=100" \
      -H "Authorization: Bearer $LOGS_API_KEY" | jq .
    ```
  Reference: [handleLogsRequest()](worker/index.ts:257)

## 7) Cutover Procedure

1. After copying all required prefixes:
   - Confirm counts match between LEGACY_KV and RAG_KV for the migrated prefixes
   - Spot-check a random sample of keys to compare values (exact text / JSON)
2. Deploy the app (if not already) using RAG_KV
3. Monitor the app for normal operations (reads/writes)
4. Keep LEGACY_KV in read-only / quiescent mode
5. After sufficient soak time and verification, remove LEGACY_KV binding from [wrangler.toml](wrangler.toml:37) and remove MIGRATION_KEY from secrets

## 8) Rollback Strategy

If issues arise post-cutover:
- Because data now lives in RAG_KV, you can re-run the migration in reverse by temporarily swapping bindings in the code or writing a small reverse-copy tool. The provided /api/migrate copies LEGACY_KV -> RAG_KV. For a reverse, we recommend a short-term admin script using Wrangler KV directly to avoid changing production code.
- If only a subset of keys is affected, migrate back specific prefixes or keys rather than a full rollback.

## 9) Safety and Limits

- Cloudflare KV reads/writes are rate-limited; batch with reasonable limits and watch tail logs
- Worker CPU constraints: Prefer multiple small invocations vs one large call
- Security: /api/migrate requires both an allowed Origin and Authorization: Bearer MIGRATION_KEY. Do not expose this endpoint to untrusted callers.

## 10) Post-Migration Cleanup

- Remove LEGACY_KV binding from [wrangler.toml](wrangler.toml:37)
- Remove MIGRATION_KEY secret
- Audit references in code and docs to ensure no usage remains of the legacy KV

## Appendix A: Troubleshooting

1) `401 Unauthorized` on /api/migrate:
- Ensure Authorization header provided and MIGRATION_KEY secret is set on the deployed Worker

2) `403 CORS origin not allowed`:
- Ensure you are calling from an allowed origin (or use curl without Origin header)
- Allowed origins are defined in [worker/index.ts](worker/index.ts:44)

3) `LEGACY_KV not configured`:
- Add the LEGACY_KV binding in [wrangler.toml](wrangler.toml:37) and deploy

4) Keys missing after migration:
- Re-run targeted batches via prefix/limit
- Validate with Wrangler CLI or /api/kv GET
- Check worker tail for kv_migration_error logs

5) High errorCount:
- Inspect `errors[]` returned by the endpoint
- Use smaller limit, inspect specific keys using Wrangler
