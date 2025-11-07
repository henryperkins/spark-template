# Shared Context & Telemetry Implementation Guide

## Overview

This document describes the implementation of **Gap #1 (Shared Context/KB-awareness)** and **Gap #2 (Token/Cost Accounting)** for the Agentic RAG system.

## What Was Implemented

### Gap #1: Shared Execution Context

**Files Created:**
- `src/lib/agents/agent-context.ts` - Complete context infrastructure

**Key Components:**

1. **`KBContext`** - Knowledge base characteristics
   - Document/chunk counts
   - Embedding availability and coverage
   - Content type distribution (code/prose/technical)
   - Main topics (optional)
   - KB fingerprint for cache invalidation
   - Azure indexing status

2. **`QueryExecutionContext`** - Complete execution state
   - KB context
   - Token budget tracking
   - Time budget tracking
   - Phase timings
   - LLM call history
   - Agent results (classification, routing, etc.)
   - Warnings accumulated during execution
   - Session metadata (optional)

3. **Helper Functions:**
   - `buildKBContext(documents)` - Extracts KB characteristics
   - `createQueryExecutionContext(...)` - Initializes context with budgets
   - `recordPhaseTime(context, phase, duration)` - Tracks phase timing
   - `recordLLMCall(context, metadata)` - Tracks token/cost usage
   - `addWarning(context, phase, code, message)` - Adds execution warnings
   - `canAffordTokens/Time(context, ...)` - Budget checks
   - `calculateCost(model, promptTokens, completionTokens)` - Cost calculation
   - `getExecutionSummary(context)` - Generates execution summary

**Files Modified:**
- `src/lib/agents/orchestrator.ts`:
  - Initializes `QueryExecutionContext` at start of `processQuery()`
  - Builds `KBContext` from documents
  - Records phase timings
  - Passes context to agents
  - Returns execution summary in `AgenticRAGResult`

### Gap #2: Token/Cost Accounting in Telemetry

**Files Modified:**
- `src/lib/services/telemetry.ts`:
  - Added `LLMMetadata` interface (model, provider, tokens, cost)
  - Added `AgentStepMetadata` interface (agent-specific metrics)
  - Extended `AgentStepEvent` with `llm`, `metadata`, `cumulativeTokens`, `cumulativeCost`

- `src/lib/agents/orchestrator.ts`:
  - Enriched `emitStepEvent` to include cumulative tokens/cost from context
  - Updated classification step to emit complexity metadata
  - Prepared for per-step LLM metadata (when captured from llmService)

## How It Works

### 1. Context Initialization

At the start of `processQuery()`:

```typescript
// Build KB characteristics from documents
const kb = buildKBContext(documents)

// Initialize execution context with budgets
const context = createQueryExecutionContext(runId, query, kb, {
  tokenBudget: 50000,    // 50k token budget
  timeBudgetMs: 60000    // 60s time budget
})
```

### 2. KB-Aware Agent Calls

Agents can now receive KB context for smarter decisions:

```typescript
// Before (no KB awareness)
const classification = await this.classifierAgent.classifyQuery(query)

// After (KB-aware)
const classification = await this.classifierAgent.classifyQuery(query, kb)
```

The classifier now considers:
- KB size (document/chunk counts)
- Content type distribution
- Embedding coverage
- Main topics

Example: "What is React hooks?" is classified as:
- **Simple** if KB has 1-2 React docs
- **Moderate** if KB has 10+ React docs with hooks section
- **Complex** if KB has 50+ docs covering React, Vue, Angular (comparative query)

### 3. Phase Timing

After each phase:

```typescript
const phaseStart = Date.now()
// ... execute phase ...
const phaseDuration = Date.now() - phaseStart
recordPhaseTime(context, 'classification', phaseDuration)
```

Tracked phases:
- `classification` - Query complexity assessment
- `routing` - Retrieval strategy selection
- `planning` - Query decomposition
- `retrieval` - Source retrieval
- `generation` - Response generation
- `validation` - Quality validation
- `refinement` - Iterative improvement
- `expansion` - Related question generation

### 4. Enriched Telemetry

Events now include:

```typescript
{
  type: 'agent_step_status',
  agent: 'Classifier',
  status: 'completed',
  duration: 1234,

  // Gap #2: Enriched fields
  cumulativeTokens: 1500,        // Total tokens consumed so far
  cumulativeCost: 0.045,         // Total cost in USD so far
  metadata: {
    complexity: 'moderate',       // Agent-specific metadata
    requiresDecomposition: false
  }
}
```

### 5. Execution Summary

Final result includes comprehensive summary:

```typescript
{
  response: "...",
  sources: [...],

  // Gap #1 & #2: Execution summary
  executionSummary: {
    totalTokens: 2500,
    totalCost: 0.075,
    llmCallCount: 5,
    warningCount: 0,
    budgetUtilization: {
      tokens: 0.05,  // 5% of 50k budget
      time: 0.12     // 12% of 60s budget
    },
    phaseBreakdown: {
      classification: 1200,
      retrieval: 2500,
      generation: 3000,
      // ...
    }
  }
}
```

## How to Extend to Other Agents

### Pattern 1: Add KB Context Parameter

**Before:**
```typescript
async selectStrategy(query: string, kb?: { totalDocuments?: number }): Promise<RoutingDecision>
```

**After:**
```typescript
import type { KBContext } from './agent-context'

async selectStrategy(query: string, kb?: KBContext): Promise<RoutingDecision> {
  // Build KB-aware prompt
  let kbContext = ''
  if (kb) {
    kbContext = `
Knowledge Base:
- ${kb.documentCount} documents
- Content: ${kb.contentTypes.code > 0.5 ? 'code-heavy' : 'documentation'}
- Embeddings: ${kb.hasEmbeddings ? 'available' : 'unavailable'}

Adjust strategy based on KB characteristics.`
  }

  const systemPrompt = `You are a retrieval strategy expert...
${kbContext}

Select optimal strategy: vector, keyword, or hybrid.`

  // ... rest of implementation
}
```

**Update orchestrator call:**
```typescript
const routing = await this.routingAgent.selectStrategy(query, kb)
```

### Pattern 2: Enrich Telemetry with Agent Metadata

**In orchestrator:**
```typescript
const routing = await this.executeStep(
  workflow,
  'Router',
  'Select retrieval strategy',
  () => this.routingAgent.selectStrategy(query, kb),
  emitWorkflowUpdate,
  (event) => {
    // Extract metadata from result
    const result = (event as { result?: RoutingDecision }).result
    emitStepEvent({
      ...event,
      metadata: {
        strategy: result?.strategy,
        routingConfidence: result?.confidence
      }
    })
  }
)
```

### Pattern 3: Record Phase Timing

**Wrap phase execution:**
```typescript
const phaseStart = Date.now()
const result = await this.executeStep(...)
const phaseDuration = Date.now() - phaseStart
recordPhaseTime(context, 'routing', phaseDuration)

// Store result in context
context.routing = result
```

### Pattern 4: Track LLM Calls (Future Enhancement)

**When LLM service returns metadata:**
```typescript
import { recordLLMCall, calculateCost } from './agent-context'

// Inside agent after LLM call
const result = await llmService.generateJson(prompt, schema, options)

// Track in context (when passed to agents)
if (context) {
  recordLLMCall(context, {
    model: 'gpt-4',
    provider: 'azure',
    promptTokens: 500,
    completionTokens: 150,
    totalTokens: 650,
    estimatedCost: calculateCost('gpt-4', 500, 150),
    temperature: 0.3,
    maxTokens: 500,
    duration: 1200
  })
}
```

## Agents Ready to Update

### High Priority (KB-Aware Decisions)

1. **RoutingAgent** (`routing-agent.ts:21`)
   - Add KB awareness: content types, embedding availability
   - Example: If `kb.hasEmbeddings === false`, never recommend `vector` strategy

2. **QueryPlannerAgent** (`query-planner.ts:34`)
   - Consider KB topics for decomposition
   - Bias sub-queries toward KB strengths

3. **CriticAgent** (`critic-agent.ts:26`)
   - Use KB characteristics to calibrate validation thresholds
   - Technical KB → expect higher faithfulness scores

4. **QueryExpansionAgent** (`query-expansion.ts:41`)
   - Already has KB topics; add content type awareness
   - Code-heavy KB → suggest code-related questions

### Medium Priority (Context Enrichment)

5. **ReActAgent** (`react-agent.ts:25`)
   - Pass token budget to limit iteration count
   - Track iteration tokens in context

6. **DocumentAnalyzerAgent** (ingestion-time, not in query path)
   - Already returns strategy; ensure strategy stored in KB context

## Telemetry Dashboards (Future)

With enriched telemetry, you can now build:

### Cost Dashboard
- Total spend per day/week/month
- Cost per query (avg, p50, p95, p99)
- Cost by agent (which agents are most expensive?)
- Cost by complexity (simple vs. complex queries)

### Performance Dashboard
- Duration by phase (where are the bottlenecks?)
- Budget utilization distribution
- Queries hitting budget limits

### Quality Dashboard
- Correlation: complexity → validation scores
- Correlation: token budget → quality
- Azure fallback rate by time of day

### Agent-Specific Metrics
- Classifier: distribution of simple/moderate/complex
- Router: strategy distribution (vector/keyword/hybrid)
- Critic: average faithfulness/relevance scores
- ReAct: iteration count distribution

## Testing Recommendations

### Unit Tests

**Test KB context builder:**
```typescript
test('buildKBContext detects code-heavy KB', () => {
  const docs = [
    { id: '1', chunks: [{ content: 'function foo() { return 42; }' }] }
  ]
  const kb = buildKBContext(docs)
  expect(kb.contentTypes.code).toBeGreaterThan(0.8)
})
```

**Test budget tracking:**
```typescript
test('token budget decreases as calls are recorded', () => {
  const context = createQueryExecutionContext('run-1', 'query', kb)
  expect(context.tokenBudget.remaining).toBe(50000)

  recordLLMCall(context, {
    model: 'gpt-4',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    estimatedCost: 0.0045,
    provider: 'azure',
    duration: 1000
  })

  expect(context.tokenBudget.remaining).toBe(49850)
  expect(context.tokenBudget.consumed).toBe(150)
})
```

### Integration Tests

**Test KB-aware classification:**
```typescript
test('classifier considers KB size', async () => {
  // Small KB
  const smallKB = buildKBContext([oneDoc])
  const resultSmall = await classifier.classifyQuery('What is React hooks?', smallKB)
  expect(resultSmall.complexity).toBe('simple')

  // Large KB
  const largeKB = buildKBContext(fiftyDocs)
  const resultLarge = await classifier.classifyQuery('What is React hooks?', largeKB)
  expect(resultLarge.complexity).toBe('moderate') // or 'complex'
})
```

**Test telemetry enrichment:**
```typescript
test('orchestrator emits enriched telemetry', async () => {
  const events: AgentStepEvent[] = []

  await orchestrator.processQuery(query, docs, {
    onStepEvent: (event) => events.push(event)
  })

  const classifierEvent = events.find(e => e.agent === 'Classifier')
  expect(classifierEvent?.metadata?.complexity).toBeDefined()
  expect(classifierEvent?.cumulativeTokens).toBeGreaterThan(0)
})
```

## Migration Path

### Phase 1: Context Foundation (✅ Complete)
- [x] Create `agent-context.ts`
- [x] Update orchestrator to initialize context
- [x] Extend telemetry schema
- [x] Update QueryClassifierAgent as example

### Phase 2: Agent Updates (Next)
- [ ] Update RoutingAgent with KB awareness
- [ ] Update QueryPlannerAgent with KB topics
- [ ] Update CriticAgent with KB-calibrated thresholds
- [ ] Update QueryExpansionAgent with content type awareness

### Phase 3: LLM Call Tracking (Future)
- [ ] Modify llmService to return token metadata
- [ ] Update orchestrator to capture LLM metadata per step
- [ ] Emit LLM metadata in telemetry events

### Phase 4: Budget Enforcement (Future)
- [ ] Check `canAffordTokens()` before expensive steps
- [ ] Skip optional steps (expansion, refinement) if budget low
- [ ] Emit warnings when approaching budget limits

### Phase 5: Dashboards (Future)
- [ ] Build cost dashboard from telemetry
- [ ] Build performance dashboard with phase breakdown
- [ ] Build quality/cost correlation analysis

## Benefits Realized

### Gap #1: Shared Context
✅ **KB-Aware Decisions**: Classifier now considers KB size/content
✅ **Phase Timing**: Track duration per phase for profiling
✅ **Centralized State**: Single source of truth for execution state
✅ **Budget Tracking**: Token/time budgets tracked throughout pipeline

### Gap #2: Token/Cost Accounting
✅ **Cumulative Metrics**: Telemetry includes running totals
✅ **Agent Metadata**: Each agent emits specific metrics
✅ **Cost Calculation**: Model-specific pricing for cost estimation
✅ **Execution Summary**: Comprehensive summary in query result

## Next Steps

1. **Update Remaining Agents**: Follow patterns above for Router, Planner, Critic, Expansion
2. **Add LLM Tracking**: Capture token/cost from llmService in real-time
3. **Implement Budget Guards**: Check budgets before expensive operations
4. **Build Dashboards**: Visualize cost, performance, quality from enriched telemetry
5. **Add Caching**: Use context fingerprint for cache keys (Gap #4)
6. **Add Retry Logic**: Use budget info to inform retry strategies (Gap #3)

## References

- **agent-context.ts**: Complete context infrastructure
- **orchestrator.ts**: Context initialization and propagation
- **telemetry.ts**: Enriched event schema
- **query-classifier.ts**: Example KB-aware agent
