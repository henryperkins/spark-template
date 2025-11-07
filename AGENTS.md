# AGENTS.md

This file provides guidance to agents when working with code in this repository.

Only non-obvious, project-specific rules are documented here.

- Azure OpenAI:
  - Use `AzureServiceManager` ([`src/lib/azure-service-manager.ts`](src/lib/azure-service-manager.ts)) as the single entry point; do not construct `AzureOpenAIService` directly in UI code.
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

- Embeddings:
  - Before embedding calls, text is truncated via `enforceEmbeddingTokenLimit` in `AzureOpenAIService` to avoid Azure 400/413s; reuse this service instead of rolling your own batching/limits.
  - `generateBatchEmbeddings` already implements adaptive batch splitting on payload errors; do not introduce parallel embedding implementations that bypass this.

- RAG and search:
  - Use `AzureServiceManager.processDocumentWithAzure` and `searchWithAzure` for Azure Search flows; they encapsulate:
    - Stable `AzureSearchDocument` shape
    - Hybrid / vector / keyword fallback logic
    - Error handling and partial failure tolerance
  - `generateResponseWithAzure` must be used for RAG-style answers so that the shared prompt format and context wiring stay consistent.

- Streaming:
  - All streaming to the UI must go through `AzureServiceManager.generateStream`, which:
    - Bridges callback-based streaming into an async iterable
    - Delegates to `AzureOpenAIService.generateCompletion` (which may use Responses streaming)
    - New streaming code should integrate with this queue pattern instead of creating independent streams.

- Error handling:
  - Azure HTTP errors should be wrapped via:
    - `AzureOpenAIService.toAzureError` (includes request context and requestId)
    - `ResponsesClient.buildError` (normalizes v1 Responses API errors)
    - When adding new Azure calls, follow these patterns so telemetry and debugging remain consistent.

- Pathing and runtime:
  - All imports must use the `@/` alias (configured in tsconfig/vite) for src modules; relative deep paths make refactors fragile.
  - Assume Cloudflare Workers as the production runtime; any new Node-only APIs (e.g., `fs`, `crypto` without WebCrypto) are invalid unless guarded or isolated from worker bundles.

- Testing:
  - Use `vitest` with the existing structure; when adding tests that exercise Azure behavior, mock network calls instead of hitting real endpoints to preserve the worker-compatible runtime.
