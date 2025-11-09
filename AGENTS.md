# AGENTS.md

This file provides guidance to agents when working with code in this repository.

Only non-obvious, project-specific rules are documented here.

- LLM Access:
  - **UI/Controller code**: Route all LLM calls through `LLMService` ([`src/lib/services/llm-service.ts`](src/lib/services/llm-service.ts)) to populate tokenTracker and recordLLMCall.
  - **Agent code**: May use `AzureServiceManager` ([`src/lib/azure-service-manager.ts`](src/lib/azure-service-manager.ts)) directly when needed.
  - Do not construct `AzureOpenAIService` directly anywhere; always use the service layer.
  - The `AzureOpenAIService` ([`src/lib/azure-openai.ts`](src/lib/azure-openai.ts)) can transparently switch between:
    - Legacy `deployments/{deployment}/chat/completions`
    - v1 Responses API via `ResponsesClient` ([`src/lib/responses-client.ts`](src/lib/responses-client.ts))
    based on `useResponsesApi` flags. Callers must not assume which transport is used.
  - Responses API config is feature-flagged via both `AzureConfig.openai.*` and `VITE_AZURE_RESPONSES_*` envs; always honor `AzureServiceManager.initialize` wiring instead of reading env vars in new code.

- Responses API usage:
  - Always go through `ResponsesClient` for `/openai/v1/responses`:
    - It normalizes `input`/`output` shapes, extracts `outputText`, maps usage, and handles SSE parsing.
    - It already understands Azure v1 peculiarities (`api-key` vs `Authorization`, `api-version` header).
  - When adding tools (function calling, MCP, code_interpreter, image_generation) or advanced fields:
    - Pass them via `CreateResponseOptions.tools`, `toolChoice`, or `extraBody` and let `ResponsesClient` forward them.
    - Do not reimplement raw fetches to `/responses` elsewhere.
  - Resiliency behaviors:
    - `ResponsesClient` applies retry/backoff for transient statuses (429/500/502/503/504) and refreshes RBAC tokens once on 401/403 when `tokenProvider` is used.
    - Streaming gracefully degrades: on SSE failure events, `ResponsesClient.streamResponse` falls back to a non-stream `createResponse` and yields the final text.
    - Optional transport fallback: when `useResponsesApi=true` and a retriable failure occurs, `AzureOpenAIService` can fall back to `/chat/completions` if `responsesFallbackEnabled` is set (or `VITE_AZURE_RESPONSES_FALLBACK_ENABLED=true`).

- Embeddings:
  - Before embedding calls, text is truncated via `enforceEmbeddingTokenLimit` in `AzureOpenAIService` to avoid Azure 400/413s; reuse this service instead of rolling your own batching/limits.
  - `generateBatchEmbeddings` already implements adaptive batch splitting on payload errors; do not introduce parallel embedding implementations that bypass this.

- RAG and search:
  - Use `AzureServiceManager.processDocumentWithAzure` and `searchWithAzure` for Azure Search flows; they encapsulate:
    - Stable `AzureSearchDocument` shape
    - Hybrid / vector / keyword fallback logic
    - Error handling and partial failure tolerance
  - `generateResponseWithAzure` must be used for RAG-style answers so that the shared prompt format and context wiring stay consistent.
  - RAG context budgeting: `AzureOpenAIService.generateRAGResponseWithMetadata` truncates context to a safe token budget to avoid 400s and keep space for outputs.

- Streaming:
  - All streaming to the UI must go through `AzureServiceManager.generateStream`, which:
    - Bridges callback-based streaming into an async iterable
    - Delegates to `AzureOpenAIService.generateCompletion` (which may use Responses streaming)
    - New streaming code should integrate with this queue pattern instead of creating independent streams.
  - MCP/tool progress: the streaming bridge is text-first; for MCP approval flows, surface state in UI via service events rather than creating parallel streams.

- Error handling:
  - Azure HTTP errors should be wrapped via:
    - `AzureOpenAIService.toAzureError` (includes request context and requestId)
    - `ResponsesClient.buildError` (normalizes v1 Responses API errors)
    - When adding new Azure calls, follow these patterns so telemetry and debugging remain consistent.
  - 400 diagnostics: `AzureOpenAIService.logResponsesClient400` logs non-secret request diagnostics (message count, tool types, presence of instructions/responseFormat, requestId) for debuggability.
  - Centralized error tracking: call `errorTracking.record(error, { type, agent, code, status, requestId })` in service-layer catch blocks so the Scaling & Performance tab reflects real-time failures.

- UI and configuration guardrails:
  - Vector dimensions: the configuration UI warns when dimensions don't match the selected embedding model and offers a one-click fix; runtime still auto-rebuilds on mismatch as a last resort.
  - Responses timeout: warn when a very small timeout is set (can interrupt streaming).

- Observability:
  - `AzureServiceManager` logs simple latency metrics and usage metadata (when available) for completions and search queries.

- Pathing and runtime:
  - All imports must use the `@/` alias (configured in tsconfig/vite) for src modules; relative deep paths make refactors fragile.
  - Assume Cloudflare Workers as the production runtime; any new Node-only APIs (e.g., `fs`, `crypto` without WebCrypto) are invalid unless guarded or isolated from worker bundles.
  - Two `runtime` modules exist:
    - `src/lib/config.ts` exports `runtime` with detection helpers (isCloudflareWorkers, getStorageMode, etc.)
    - `src/lib/runtime-context.ts` exports `runtime` with service providers (llm, kv, telemetry)

- Testing:
  - Use `vitest` with the existing structure; when adding tests that exercise Azure behavior, mock network calls instead of hitting real endpoints to preserve the worker-compatible runtime.
