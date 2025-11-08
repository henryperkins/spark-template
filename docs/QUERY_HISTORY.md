# Query History Design

## Overview

`QueryHistoryService` (`src/lib/services/query-history.ts`) is the centralized telemetry and observability layer for queries. It stores structured `QueryHistoryEntry` records that capture:

- What was asked.
- How it was routed.
- How retrieval and generation behaved.
- How agentic workflows executed.
- Quality and performance signals (system-provided today; human feedback planned).

Primary consumers:

- `SearchDebugger` for per-query inspection.
- `QueryInterface` for recent query suggestions.
- `ScalingDashboard` for performance, routing, and quality analytics.
- `AgenticOrchestrator` as the writer for rich agentic runs.

## Storage Model

- Uses Cloudflare KV via `createCloudflareKV()` with key `query-history` as primary storage.
- Falls back to `window.localStorage` when KV is unavailable.
- Maintains an in-memory cache to minimize repeated reads.
- Retention is bounded by `MAX_ENTRIES = 100` (newest entries first).

## `QueryHistoryEntry` Structure (Current)

Core fields:

- `id: string`
- `timestamp: string`
- `query: string`

Routing:

- `routing: { strategy: 'vector' | 'keyword' | 'hybrid'; reasoning: string; confidence: number }`

Retrieval / outcome:

- `resultCount: number`
- `topScore: number`
- `azureUsed: boolean`
- `azureFallback: boolean`

Performance:

- `totalDuration: number`
- `retrievalDuration?: number`
- `retrievalAvgScore?: number`

Agentic / quality (optional, primarily for orchestrated runs):

- `workflow?: { agent: string; action: string; duration: number; status: 'pending' | 'running' | 'completed' | 'failed' }[]`
- `complexity?: 'simple' | 'moderate' | 'complex'`
- `requiresDecomposition?: boolean`
- `validation?: { faithfulnessScore: number; relevanceScore: number; isValid: boolean }`
- `executionSummary?: {
  totalDuration: number
  totalTokens: number
  totalCost: number
  llmCallCount: number
  warningCount: number
  budgetUtilization: { tokens: number; time: number }
  phaseBreakdown: Record<string, number>
}`

> Note: `executionSummary` is produced by `getExecutionSummary(context)` in the orchestrator and consumed by dashboards for phase timings and budget utilization.

## Service API

Key methods in `QueryHistoryService`:

- `add(entry)`: prepend entry, trim to `MAX_ENTRIES`, persist (KV → localStorage), update cache.
- `getAll()`: return cached entries or load from storage.
- `getRecent(limit)`: return most recent `limit` entries.
- `search(term)`: filter entries by `query` text.
- `getByStrategy(strategy)`: filter by `routing.strategy`.
- `getStats()`: compute `{ total, avgDuration, azureFallbackRate, strategyDistribution }`.
- `clear()`: clear history and cache.
- `invalidateCache()`: force reload on next read.

## How Entries Are Written

### Non-agentic queries (`QueryInterface`)

- After `findRelevantChunks` + `generateResponse`:
  - Logs: `id`, `timestamp`, `query`,
  - `routing.strategy` (e.g. `hybrid`),
  - `resultCount`, `topScore`,
  - `azureUsed`, `azureFallback`,
  - `totalDuration`.
- Does not populate `workflow` or `executionSummary`.

### Agentic queries (`AgenticOrchestrator`)

- Uses `executeStep` to build a `workflow` of agent steps:
  - Each step: `agent`, `action`, `status`, `duration`.
- Tracks phase timings and token/cost usage via a `QueryExecutionContext`.
- Builds:
  - `executionSummary = getExecutionSummary(context)`.
  - `routing` from `RoutingAgent` when available, or a synthetic descriptor for decomposed plans.
  - `validation` from `CriticAgent`.
  - `complexity` / `requiresDecomposition` from `QueryClassifierAgent`.
  - `retrievalDuration` / `retrievalAvgScore`.
  - `azureFallback` indicator.
- Calls `queryHistoryService.add(...)` asynchronously with these fields.

Result: Query History holds a compact, structured trace of each agentic run.

## How Entries Are Used

- `SearchDebugger`:
  - Loads full history + stats.
  - Renders Query History table with filters and expanded views showing routing, workflow, validation, timings, Azure usage.
  - Supports clearing history via `clear()`.

- `QueryInterface`:
  - Uses `getAll()` on mount to derive a small set of recent unique queries for "Recent questions" shortcuts.

- `ScalingDashboard`:
  - Uses `getRecent(25)` as `recentHistory`.
  - Derives:
    - Whether enriched telemetry is available (`workflow` / `executionSummary`).
    - Average phase durations from `executionSummary.phaseBreakdown`, or from `workflow` as a fallback.
    - Average budget utilization from `executionSummary.budgetUtilization`.
    - Retrieval metrics from `retrievalAvgScore`, `retrievalDuration`, `azureFallback`.

## Known Gaps & Considerations

These capture the current inception state and guide future iterations.

- No explicit human feedback yet:
  - No `userFeedback` field or API to record thumbs-up/down or comments.
  - All quality signals are system-generated (e.g. `validation`).

- Self-learning not fully wired:
  - `QueryClassifier`, `QueryPlanner`, and `QueryExpansion` do not yet consume Query History.
  - Query History already contains the right signals (routing, validation, executionSummary, workflow) to inform smarter decisions.

- Routing semantics for decomposed queries:
  - Decomposed/plan-based runs use a synthetic `routing` entry.
  - Dashboards should treat this as a special case, not as a literal retrieval strategy metric.

- Limited source traceability:
  - Entries do not currently store which specific chunks were used.
  - A bounded `sourceSample` (e.g. top N `(documentName, chunkId)`) is a low-cost future enhancement.

- Storage behavior visibility:
  - KV failures fall back to localStorage with console warnings only.
  - A future improvement is exposing a simple flag so UIs can warn when running in fallback mode.

- Retention & isolation:
  - History is global (per deployment) and capped at 100 entries.
  - Real deployments may need per-namespace/user scoping and configurable retention/privacy controls.

## Proposed Minimal Enhancements (Next Steps)

The following non-breaking improvements are recommended:

1. Add optional fields to `QueryHistoryEntry`:
   - `userFeedback?: { rating?: 'up' | 'down'; comment?: string }`.
   - `sourceSample?: { documentName: string; chunkId: string }[]`.

2. Add helpers to `QueryHistoryService`:
   - `addFeedback(id, feedback)` to attach human feedback to existing entries.
   - Convenience queries like `getRecentSuccessful` / `getRecentFailures` for agents.

3. Update `AgenticOrchestrator` logging:
   - Populate `sourceSample` from top sources.
   - Make synthetic routing for decomposed plans clearly distinguishable (reasoning + confidence).

4. Let `QueryClassifier`, `QueryPlanner`, and `QueryExpansion` optionally consume Query History:
   - Use recent successes/failures to make small, safe adjustments (e.g., when to decompose, how to plan, which expansions to favor).

These steps keep `QueryHistoryService` as the single source of truth for query telemetry while enabling gradual, data-informed self-learning.
