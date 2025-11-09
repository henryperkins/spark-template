# [[Handling Incomplete Responses and Extracting Partial Output]]

This note explains how our LLM pipeline handles:

- Incomplete/truncated responses
- Failed JSON parsing
- Failed text extraction from Responses API output
- Fallback and JSON repair behavior

It is based on:

- [[response-client.ts]]
- [[llm-service.ts]]
- [[document-analyzer.ts]]
- [[orchestrator.ts]]
- [[json-repair-agent.ts]]

---

## 1. High-Level Flow

- Orchestrated user/query workflows use [[llm-service.ts]] and agents in [[orchestrator.ts]].
- Document chunking decisions use [[document-analyzer.ts]].
- Both rely on:
  - Azure OpenAI Responses/Completions via [[response-client.ts]] or `azureServiceManager`.
  - Robust JSON parsing and repair via [[llm-service.ts]] and [[json-repair-agent.ts]].

The system is designed to:

- Prefer strict, valid JSON when requested.
- Tolerate malformed / partial responses.
- Fall back to heuristics without breaking UX.
- Emit clear telemetry and logs for debugging.

---

## 2. ResponsesClient: Extracting Text from Responses API

Location: [[response-client.ts]]

Responsibilities:

- Wrap Azure `/openai/v1/responses`.
- Handle:
  - Single responses (create/retrieve/cancel/delete).
  - Streaming via SSE.
- Normalize outputs into `ResponsesResult`:
  - `outputText`
  - `messages[]`
  - `usage`
  - `reasoningPreview`
  - `raw` (full provider payload)

Key behaviors:

1) Request construction

- `buildRequestBody`:
  - Encodes messages into `input` with `input_text` items.
  - Adds:
    - `model`
    - `stream`
    - sampling params (only for non-strict models)
    - `max_output_tokens`
    - `store`, `background`
    - tools, tool_choice
    - responseFormat → `text.format` (text/json_object/json_schema)
    - `previous_response_id`, `instructions`, `reasoning`, `extraBody`

2) Auth, retries, timeout

- `fetchWithAuth`:
  - Adds `api-key` or `Authorization`.
  - Sets `api-version` header.
  - Optional timeout via `AbortController`.
  - Optional retry via `fetchWithRetry`:
    - Retries on 429/5xx with exponential backoff + jitter.

3) Streaming

- `streamResponse`:
  - Reads `text/event-stream` lines.
  - For each `data:` line:
    - Parses JSON.
    - Uses `extractTextDelta` for incremental text.
    - On error-ish events (`response.failed`, `error`, etc.), optionally falls back:
      - Calls `createResponse` once non-streaming.
  - At end:
    - If `lastJson` exists → `toResult(lastJson, fullText)` → `message-complete`.
    - Else if any `fullText` → synthetic `ResponsesResult`.

4) Output normalization

- `toResult(json, overrideText?)`:
  - `outputText`:
    - `overrideText` if provided
    - else `extractFirstOutputText(json)`
    - else `''`
  - `messages` from `json.output` where `type === 'message'`.
  - `usage` normalized from `json.usage`.
  - `reasoningPreview` from `extractReasoningPreview(json)`.

5) Extracting output text

Core function: `extractFirstOutputText(json)`.

Extraction order (intentionally robust):

- If `json.status === 'incomplete'`:
  - Logs:
    - `[ResponsesClient] Incomplete response; attempting to extract partial output`
  - Still attempts extraction.

Then:

1) Top-level fields:
   - `json.text`
   - `json.output_text`
   - reasoning fields:
     - `reasoning_summary_text`, `reasoning_content`
     - `reasoning.summary_text` / `.text` / `.content`

2) Nested `response` object:
   - Same pattern:
     - `response.output_text`, `response.text`
     - `response.reasoning_*` / `response.reasoning.*`

3) Reasoning items in `json.output`:
   - `extractReasoningChunks(output)`:
     - Looks for `type === 'reasoning'` and `summary[].type === 'summary_text'`.
     - Returns concatenated reasoning text if found.

4) General text from `json.output`:
   - `collectTextFromOutput(output)`:
     - Collects from:
       - `output_text`
       - `text` (non-`input_text`)
       - string arrays
       - nested `content`, `summary`, `output` fields
     - Recurses as needed.

5) Extra fallbacks:
   - `json.message` (string)
   - `json.a.text` or `json.a.message` (for odd wrappers)

6) Last-ditch:
   - First `json.output[0]`:
     - `content` (string)
     - `text` (string)
     - nested `content` array via `collectTextFromContentNode`

If all fail:

- Logs structured warning:
  - `[ResponsesClient] Failed to extract output text. Response structure: { ... }`
- Returns `undefined`.

This explains the console logs you see:
- They are emitted only after multiple structured fallback attempts fail.

---

## 3. LLMService: JSON and Text Generation

Location: [[llm-service.ts]]

Responsibilities:

- Provide:
  - `generateText(...)`
  - `generateJson(...)`
  - `generateRawJson(...)`
  - `generateTextStream(...)`
- Apply:
  - Rate limiting (token bucket).
  - Timeouts.
  - Retries.
  - Cost and token accounting.
  - Provider selection:
    - Prefer Azure (`azureServiceManager`).
    - Fallback to `Worker` proxy or stub.

Key pieces:

1) Error model

- `LLMError` with codes:
  - `ETIMEDOUT`, `ERATELIMIT`, `EPARSE`, `EREMOTE`
- `rawText` field used for JSON repair on EPARSE.

2) Strict vs flexible models

- `isStrictDeployment` + `sanitizeOptionsForDeployment`:
  - Avoid unsupported parameters for strict models (`gpt-5-mini-*`, `o1*`, etc.).

3) `generateText`

- Uses Azure (or worker) with timeout + retry.
- Records outcome via `recordLLMOutcome`:
  - Tracks tokens, cost, metadata.
- Throws `LLMError` on failures.

4) `generateJson` and `generateRawJson`

- `generateJson`:
  - Calls `generateRawJson`.
  - Validates with Zod schema.
  - On schema failure → wraps as `LLMError('EPARSE', ...)`.

- `generateRawJson`:
  - Enforces JSON mode where possible:
    - Azure:
      - `responseFormat: 'json_object'`.
    - Worker:
      - `json: true` hints + deterministic stubs.
  - For Azure:
    - If `text` is empty → `LLMError('EPARSE', 'Azure LLM returned empty JSON response')`.
    - Else parse via `parseJson`.
  - For Worker:
    - If empty in JSON mode → returns stub JSON instead of failing where possible.
  - Records outcome via `recordLLMOutcome`.

5) `parseJson(response: string)`

Robust parser with multiple strategies:

- Empty → EPARSE: "Empty LLM response when JSON expected".
- Direct `JSON.parse`.
- Look for ```json fenced blocks.
- Look for generic ``` fenced blocks.
- Balanced-brace scan:
  - Extracts first plausible `{ ... }` segment.
- If all fail:
  - Logs:
    - `[llm-service] Failed to parse JSON. Raw response (truncated): ...`
  - Throws:
    - `LLMError('EPARSE', 'Could not parse JSON from LLM response', ..., rawSnippet)`

These errors surface later as:
- `LLM_JSON_PARSE_FAIL` events in higher-level agents.

6) `safeParseJson(raw)`

- Utility to parse "JSON-like" output:
  - Trims, strips fences, attempts `JSON.parse`.
  - On failure: returns `{ _parseError, _raw }` instead of throwing.

---

## 4. JSON Repair and Document Analyzer

### 4.1 JSONRepairAgent

Location: [[json-repair-agent.ts]]

Purpose:

- Best-effort repair of malformed JSON that should match a known Zod schema.

Algorithm:

- Start from `rawText`:
  - Try as-is.
  - Try fenced ```json blocks.
  - Try first `{...}` block.
  - Heuristic cleanups:
    - Normalize quotes.
    - Remove trailing commas.
    - Quote bare keys.
    - Convert some single-quoted strings.
- For each candidate:
  - `JSON.parse` → `schema.parse`.
- On success:
  - `{ ok: true, value, attempts }`.
- On failure:
  - `{ ok: false, error: { message, originalSnippet } }`.

### 4.2 DocumentAnalyzerAgent

Location: [[document-analyzer.ts]]

Purpose:

- Decide chunking strategy (strategy, chunkSize, overlap, reasoning) for ingestion.

Flow:

1) Build strict JSON-only system prompt.
2) Call:
   - `llmService.generateJson(..., chunkingDecisionSchema)`.
3) On success:
   - Return `{ ok: true, value }`.

4) On `LLMError('EPARSE')`:
   - Extract `rawText` from error.
   - Call `jsonRepairAgent.tryRepairJson`.
   - If repair succeeds:
     - Log `LLM_JSON_REPAIR_SUCCESS`.
     - Return repaired value with `meta.repaired`.
   - If repair fails:
     - Log:
       - `[DocumentAnalyzerAgent] LLM_JSON_PARSE_FAIL → LLM_FALLBACK_USED`
       - Includes `hadRawText` and `rawPreview`.
     - Use `fallbackAnalysis(...)` heuristics.
     - Return `{ ok: true, value: fb, meta: { fallback: true, reason: 'json_parse_failed' } }`.

5) On other errors:
   - Log `LLM_UNAVAILABLE → LLM_FALLBACK_USED`.
   - Use conservative fallback.

6) `analyzeDocument(...)`:
   - Wraps result, always returns a valid `ChunkingDecision`.

This is the direct source of the parse/fallback logs in your console.

---

## 5. Orchestrator Integration

Location: [[orchestrator.ts]]

Relevant points:

- Uses:
  - `DocumentAnalyzerAgent` for document analysis pipelines.
  - `llmService` for query-time steps (Classifier, Planner, Router, Retrieval, Generator, Critic, ReAct, Expansion).
- Tracks:
  - Step-level workflow.
  - LLM usage via `llmService.getLastLLMMetadata()` and context.
  - Fallbacks and degraded paths (e.g., Azure retrieval fallback).
- When document analysis runs (`processDocumentAnalysis`):
  - Calls `docAnalyzer.analyzeDocumentResult`.
  - On parse failures:
    - Adds telemetry events:
      - `LLM_JSON_PARSE_FAIL`
      - `LLM_FALLBACK_USED`
  - Caches decisions with semantic hash.
  - Always returns safe defaults if something goes wrong.

---

## 6. Why You See Those Console Messages

Common messages and their meaning:

- `[ResponsesClient] Incomplete response; attempting to extract partial output`
  - Response marked `status: 'incomplete'` or partially structured.
  - Client still tries to salvage text via multiple fallbacks.

- `[ResponsesClient] Failed to extract output text. Response structure: {...}`
  - After all extraction strategies, nothing usable found.
  - Indicates unexpected or new response shape.

- `[llm-service] Failed to parse JSON. Raw response (truncated): ...`
  - `parseJson` couldn’t find valid JSON.
  - Leads to `LLMError('EPARSE')`.

- `[DocumentAnalyzerAgent] LLM_JSON_PARSE_FAIL → LLM_FALLBACK_USED { ... }`
  - JSON parsing (and repair) failed for chunking decision.
  - Agent fell back to heuristic strategy.

These logs are intentional:

- They don’t necessarily mean user-visible failures.
- They help you debug model/adapter misbehavior, malformed outputs, or integration issues.

---

## 7. Practical Guidance

If you see frequent warnings:

- Check provider outputs:
  - Are models always honoring `json_object` / schema instructions?
  - Any HTML/plain-text error pages being returned?
- Validate response shapes against:
  - `ResponsesClient` expectations:
    - `json.output` items structure
    - reasoning items (`type: 'reasoning'`, `summary[]`)
- Consider:
  - Tightening prompts to enforce valid JSON.
  - Adjusting model/deployment if it often violates format.
  - Monitoring:
    - Count of `EPARSE`, `LLM_JSON_PARSE_FAIL`, `LLM_FALLBACK_USED`.
- Use these logs as signals to improve:
  - LLM instruction tuning.
  - Response adapters.
  - Error handling paths.

---

If you’d like, I can:

- Generate a shorter “Debugging Checklist” section inside this note.
- Or split this into multiple linked notes (e.g. [[ResponsesClient Diagnostics]], [[LLM JSON Parsing & Repair]], [[Document Analyzer Fallbacks]]).
