# Agent Context Flow and Query History Integration

## Overview

This document explains how context is created, propagated, and persisted across the application, with a focus on:

- How agents share context during a single query run.
- How infra services (LLM/Azure/telemetry) participate in that context.
- How `QueryHistoryService` captures a durable summary of each run.

It complements `docs/context-architecture.md`, `docs/CONTEXT-FLOW-ANALYSIS.md`, and `docs/QUERY_HISTORY.md` by describing the concrete, implemented end-to-end flow.

## Layers of Context

The system manages context in three layers:

1. Per-request execution context
2. Cross-agent telemetry and streaming context
3. Persistent query history context

Each layer is explicit and type-safe, and higher layers are derived from lower ones (never re-invented ad hoc).

---

## 1. Per-Request Execution Context

**Key files:**
- `src/lib/agents/agent-context.ts`
- `src/lib/agents/context-registry.ts`
- `src/lib/agents/orchestrator.ts`

### Creation

For each agentic query, `AgenticOrchestrator.processQuery` constructs a `QueryExecutionContext`:

- Builds a `KBContext` from documents via `buildKBContext(documents)`:
  - Document and chunk counts
  - Embedding availability and coverage
  - Content type heuristics (code/prose/technical)
  - Azure indexing flags and a KB fingerprint
- Calls `createQueryExecutionContext(runId, query, kb, { tokenBudget, timeBudgetMs })` to create:
  - `query`, `runId`, `kb`
  - `tokenBudget` (total, consumed, remaining, cost, exhausted)
  - `timeBudget` (total, per-phase allocations, consumed, remaining, exhausted)
  - `phaseTimings`
  - `llmCalls`
  - `warnings`
  - `azureFallback` flag and optional `session`

The orchestrator immediately exposes this via `setActiveQueryContext(context)`.

### Mutation

Helpers in `agent-context.ts` are the only sanctioned way to mutate execution context:

- `recordPhaseTime(context, phase, duration)`
  - Updates `phaseTimings` and time budget consumption.
- `recordLLMCall(context, metadata)`
  - Appends LLM call details and adjusts token/cost budgets.
- `addWarning(context, phase, code, message)`
  - Records structured warnings.
- `canAffordTokens` / `canAffordTime`
  - Allow agents or orchestration to make budget-aware decisions.
- `getExecutionSummary(context)`
  - Produces a stable `ExecutionSummary`:
    - `totalDuration`, `totalTokens`, `totalCost`
    - `llmCallCount`, `warningCount`, `azureFallback`
    - `budgetUtilization` (tokens/time ratios)
    - `phaseBreakdown` (per-phase ms)

### Lifecycle and Safety

- `context-registry.ts` holds a single `activeContext`:
  - `setActiveQueryContext(ctx)` sets it for the lifetime of a run.
  - `getActiveQueryContext()` lets infra services integrate without threaded args.
- `AgenticOrchestrator.processQuery` wraps its body in `try/finally` and always calls `setActiveQueryContext(null)`.

This yields a clear invariant: at most one active query context is visible at a time, and it is cleared after each run to prevent leakage.

---

## 2. LLM and Azure Services: Context-Aware Infrastructure

**Key files:**
- `src/lib/azure-service-manager.ts`
- `src/lib/services/llm-service.ts`
- `src/lib/services/token-tracker.ts`

### AzureServiceManager

- Single entry point for Azure usage:
  - Initializes `AzureOpenAIService` and `AzureSearchService` from `AzureConfig` + feature flags.
  - Provides methods for completions, streaming, embeddings, and search index operations.
- Does not own query-level context; instead, it exposes primitives used by `LLMService` and orchestrator.
- On failures, wraps and records errors via `errorTracking` with consistent metadata.

### LLMService

`LLMService` centralizes LLM calls and glues them to the execution context:

- Public methods:
  - `generateText`, `generateJson`, `generateTextStream`.
- Behavior:
  - Applies QPS rate limiting and retries.
  - Prefers Azure via `azureServiceManager`; falls back to a worker proxy when needed.
  - For each call, `recordLLMOutcome`:
    - Uses provider-returned usage when available; otherwise estimates tokens.
    - Computes cost via `calculateCost` from `agent-context.ts`.
    - Reads `getActiveQueryContext()` and, if present, calls `recordLLMCall(context, ...)`:
      - This attaches accurate tokens/costs/durations to the current run.
    - Also logs usage to `tokenTracker` for global metrics.

### Impact on Context Flow

- Orchestrator and agents call `LLMService` without manual context wiring.
- `LLMService` and `AzureServiceManager` enrich the active `QueryExecutionContext` implicitly.
- This ensures the eventual `ExecutionSummary` and `QueryHistoryEntry` reflect real usage and costs.

---

## 3. AgenticOrchestrator: Coordinated Multi-Agent Workflow

**Key file:**
- `src/lib/agents/orchestrator.ts`

### Workflow Management

The orchestrator coordinates all agents using a consistent pattern:

- Agents involved:
  - `QueryClassifierAgent`, `QueryPlannerAgent`, `RoutingAgent`, `CriticAgent`, `ReActAgent`, `QueryExpansionAgent`, `DocumentAnalyzerAgent`, plus retrieval helpers from `rag.ts`.
- `executeStep` wrapper:
  - Creates a `workflow` entry: `{ agent, action, status, timestamp, duration?, result }`.
  - Invokes optional `onWorkflowUpdate` callbacks for live UI updates.
  - Emits enriched `AgentStepEvent`s (see Telemetry section).
  - On errors:
    - Marks step as failed.
    - Records via `errorTracking` with `{ agent, type, code }`.

### Context Passing Between Agents

- `KBContext` is passed explicitly into routing and retrieval decisions so they are KB-aware.
- Sub-queries from `QueryPlannerAgent` are executed in `executeSubQueries` with:
  - Per-sub-query routing using `RoutingAgent` and `KBContext`.
  - Consolidated source lists.
- Retrieval helpers (`findRelevantChunks` / Azure search) can signal fallbacks; the orchestrator reflects these into the context (`azureFallback`) and workflow.

### Execution Summary

At the end of `processQuery`:

1. Total duration is computed.
2. `getExecutionSummary(context)` is called to capture usage, costs, warnings, and phase timings.
3. An `AgenticRAGResult` is returned containing:
   - `response`, `sources`
   - `classification`, `routing`, `plan`
   - `validation`, `refinement`, `expansion`
   - `workflow` (all agent steps)
   - `totalDuration`, `azureFallback`
   - `executionSummary`

This same data is also used to write into `QueryHistoryService`.

### Safety

- `try/finally` ensures `activeContext` is cleared.
- Failures in telemetry or history logging are caught so they never break the core answer path.

---

## 4. Telemetry and Streaming Context

**Key files:**
- `src/lib/services/telemetry.ts`
- `src/lib/services/agent-analytics.ts`
- `src/lib/services/error-tracker.ts`
- `src/lib/services/token-tracker.ts`

### Agent Step Telemetry

`executeStep` in the orchestrator emits `AgentStepEvent` objects:

- Fields include:
  - `runId`, `query`, `agent`, `action`, `status`, `stepIndex`, `timestamp`
  - Optional `duration`, `failureReason`
  - Optional `llm` metadata (from usage), `metadata` (e.g., classification complexity, routing choice), and cumulative token/cost fields.
- `TelemetryService` (`telemetry.ts`) sends these to `runtime-telemetry` as `agent_step_status` events.

### Alerts and Analytics

- `AgentAlertEvent` surface long-running or failed steps.
- `tokenTracker` and `errorTracking` expose aggregate metrics used by `ScalingDashboard`.

These channels provide a live, event-stream view of context evolution during a run, complementing the final snapshot persisted in query history.

---

## 5. QueryHistoryService: Durable Context Snapshot

**Key files:**
- `src/lib/services/query-history.ts`
- `docs/QUERY_HISTORY.md`

`QueryHistoryService` persists a compact summary of each query run as `QueryHistoryEntry` records.

### Data Captured

Each `QueryHistoryEntry` includes:

- Core:
  - `id`, `timestamp`, `query`
- Routing and retrieval:
  - `routing: { strategy; reasoning; confidence }`
  - `resultCount`, `topScore`
  - `azureUsed`, `azureFallback`
  - `retrievalDuration?`, `retrievalAvgScore?`
- Workflow summary (for agentic runs):
  - `workflow?: Array<{ agent; action; duration; status }>`
- Semantics and quality:
  - `complexity?`, `requiresDecomposition?`
  - `validation?: { faithfulnessScore; relevanceScore; isValid }`
- Execution summary:
  - `executionSummary?: {
      totalDuration
      totalTokens
      totalCost
      llmCallCount
      warningCount
      budgetUtilization: { tokens; time }
      phaseBreakdown: Record<string, number>
    }`

This schema directly mirrors the orchestrator’s `ExecutionSummary` and agent workflow, avoiding divergence between runtime context and stored history.

### Storage Model

- Primary: Cloudflare KV via `createCloudflareKV()` with key `query-history`.
- Fallback: `window.localStorage` when KV is unavailable (browser/dev).
- Uses JSON serialization plus:
  - `normalize` to guard against malformed data.
  - `cloneHistory` to avoid exposing mutable internal references.
- `MAX_ENTRIES = 100` retains recent, relevant history.

### API

- `add(entry)` — prepend and persist.
- `getAll()`, `getRecent(limit)` — read history.
- `search(term)` — text search over `query`.
- `getByStrategy(strategy)` — filter by routing.
- `getStats()` — `total`, `avgDuration`, `azureFallbackRate`, `strategyDistribution`.
- `clear()` and `invalidateCache()`.

### How It’s Written

- Agentic queries:
  - `AgenticOrchestrator.processQuery` calls `queryHistoryService.add({ ... })`:
    - Uses actual routing, metrics, workflow, classification, validation, and `executionSummary`.
    - Runs asynchronously; errors are logged but do not affect responses.
- Non-agentic queries:
  - `QueryInterface` logs a simpler entry (no workflow/summary) after retrieval + generation.

This makes `QueryHistoryService` the durable projection of the per-run context, tailored for analytics and UX.

---

## 6. UI & Dashboard Consumption

**Key files:**
- `src/components/QueryInterface.tsx`
- `src/components/SearchDebugger.tsx`
- `src/components/ScalingDashboard.tsx`

### QueryInterface

- On mount, reads `queryHistoryService.getAll()` to surface recent queries.
- For agentic runs:
  - Uses `AgenticOrchestrator` with `onWorkflowUpdate` and `onStepEvent` for live visualization.
  - Orchestrator itself logs into history.
- For non-agentic runs:
  - Manually writes history entries with basic routing/latency fields.

### SearchDebugger

- Uses `queryHistoryService.getAll()` and `getStats()` to:
  - Inspect per-query routing, workflows, validation, and performance.
  - Filter by strategy and search term.
- Provides controls to clear history.

### ScalingDashboard

- Uses `queryHistoryService.getRecent(25)` plus `tokenTracker` and `errorTracking` to:
  - Monitor performance, fallback rates, and routing distributions.
  - Correlate history entries with token usage and errors.

Together, these surfaces rely on the same canonical history and context structures, ensuring consistent explanations of system behavior.

---

## 7. Design Evaluation & Guidelines

### Strengths

- Single orchestrator-driven `QueryExecutionContext` per run.
- `LLMService` + `AzureServiceManager` integrate with context via `getActiveQueryContext` without leaking provider details to UI.
- `QueryHistoryService` stores a faithful, compact snapshot derived from execution context.
- Telemetry and dashboards consume standardized events and entries.

### Risks & Considerations

- `context-registry` is intentionally simple and assumes one active run per environment segment:
  - If you introduce true parallel, multi-user execution in a shared runtime, replace it with a request-scoped or async-local mechanism.
- When adding new agents or phases:
  - Extend `QueryExecutionContext` and `ExecutionSummary` first.
  - Ensure `AgenticOrchestrator` records timings and results via helpers.
  - Update `QueryHistoryEntry` and `docs/QUERY_HISTORY.md` if you want history to reflect new signals.
- Keep UI and analytics logic tolerant of missing optional fields for backward compatibility.

### When Implementing New Features

- Use `LLMService` and `azureServiceManager` for all LLM/Azure calls.
- Use `recordPhaseTime`, `recordLLMCall`, and `addWarning` when building new phases.
- Use `queryHistoryService` (not ad-hoc storage) for any persisted query/run summaries.
- Emit `AgentStepEvent`s via the orchestrator’s `executeStep` pattern for any new agent steps.

This keeps context coherent from the first token generated to the last line in the history dashboard.
