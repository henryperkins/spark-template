# Context Flow Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Query Arrives                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator.processQuery(query, documents, options)          │
│                                                                 │
│  Step 1: Build KB Context                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ kb = buildKBContext(documents)                          │  │
│  │ → documentCount, chunkCount                             │  │
│  │ → hasEmbeddings, embeddingCoverage                      │  │
│  │ → contentTypes: { code, prose, technical }              │  │
│  │ → topics, fingerprint, azureIndexed                     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              ↓                                  │
│  Step 2: Initialize Execution Context                          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ context = createQueryExecutionContext(runId, query, kb)│  │
│  │ → tokenBudget: { total: 50000, remaining: 50000 }      │  │
│  │ → timeBudget: { total: 60000, phases: {...} }          │  │
│  │ → phaseTimings: {}                                      │  │
│  │ → llmCalls: []                                          │  │
│  │ → warnings: []                                          │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Pipeline Execution                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Classification                                         │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ const start = Date.now()                                    ││
│ │ classification = await classifier.classifyQuery(query, kb)  ││
│ │                                                             ││
│ │ Classifier Agent receives KB context:                       ││
│ │   • documentCount, chunkCount                               ││
│ │   • contentTypes, topics                                    ││
│ │   • Enriches prompt with KB info                            ││
│ │                                                             ││
│ │ recordPhaseTime(context, 'classification', duration)        ││
│ │ context.classification = classification                     ││
│ │                                                             ││
│ │ Telemetry Emission:                                         ││
│ │   • agent: 'Classifier'                                     ││
│ │   • status: 'completed'                                     ││
│ │   • duration: 1234ms                                        ││
│ │   • cumulativeTokens: context.tokenBudget.consumed          ││
│ │   • cumulativeCost: context.tokenBudget.costConsumed        ││
│ │   • metadata: { complexity, requiresDecomposition }         ││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2-N: Other Agents (Routing, Retrieval, etc.)            │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Same pattern for each agent:                                ││
│ │   1. Record start time                                      ││
│ │   2. Pass KB context (when updated)                         ││
│ │   3. Execute agent logic                                    ││
│ │   4. recordPhaseTime(context, phase, duration)              ││
│ │   5. Store result in context                                ││
│ │   6. Emit enriched telemetry with metadata                  ││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Generate Execution Summary                    │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ executionSummary = getExecutionSummary(context)             ││
│ │ → totalTokens: sum of all llmCalls                          ││
│ │ → totalCost: sum of all llmCall costs                       ││
│ │ → llmCallCount: context.llmCalls.length                     ││
│ │ → phaseBreakdown: { classification: 1234, routing: 567 }   ││
│ │ → budgetUtilization: { tokens: 0.05, time: 0.12 }          ││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Return AgenticRAGResult                      │
│ {                                                               │
│   response: "AI-generated answer",                              │
│   sources: [...],                                               │
│   classification: {...},                                        │
│   routing: {...},                                               │
│   validation: {...},                                            │
│   workflow: [...],                                              │
│   executionSummary: {           // ← NEW from Gap #1 & #2      │
│     totalTokens: 2500,                                          │
│     totalCost: 0.075,                                           │
│     llmCallCount: 5,                                            │
│     phaseBreakdown: {                                           │
│       classification: 1200,                                     │
│       routing: 800,                                             │
│       retrieval: 2500,                                          │
│       generation: 3000                                          │
│     }                                                           │
│   }                                                             │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Telemetry Event Flow

```
┌────────────────────────┐
│ Agent Step Executes    │
└────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────────┐
│ emitStepEvent({                                                │
│   agent: 'Classifier',                                         │
│   action: 'Classify query complexity',                         │
│   status: 'completed',                                         │
│   duration: 1234,                                              │
│   stepIndex: 0,                                                │
│                                                                │
│   // Gap #2: Enriched fields                                  │
│   cumulativeTokens: context.tokenBudget.consumed,  // 1500    │
│   cumulativeCost: context.tokenBudget.costConsumed, // $0.045 │
│   metadata: {                                                  │
│     complexity: 'moderate',                                    │
│     requiresDecomposition: false                               │
│   }                                                            │
│ })                                                             │
└────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────┐
│ telemetry.trackAgentStep│ ──→ Worker /api/telemetry endpoint
└─────────────────────────┘
           ↓
┌─────────────────────────┐
│ agentAnalytics.record   │ ──→ Alert thresholds, KV storage
└─────────────────────────┘
           ↓
┌─────────────────────────┐
│ options.onStepEvent     │ ──→ UI real-time workflow updates
└─────────────────────────┘
```

## KB Context Usage in Agents

### Before (No Context)
```
┌───────────────┐
│     Query     │
└───────────────┘
       ↓
┌───────────────┐
│  Classifier   │
│  Agent        │
│               │
│ Uses generic  │
│ heuristics    │
└───────────────┘
       ↓
┌───────────────┐
│ Classification│
└───────────────┘
```

### After (With KB Context)
```
┌─────────────────────────────────────┐
│     Query     +    KB Context       │
│                                     │
│  KB Context:                        │
│  • documentCount: 15                │
│  • chunkCount: 234                  │
│  • contentTypes: { prose: 0.7 }     │
│  • topics: ['React', 'TypeScript']  │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│         Classifier Agent            │
│                                     │
│ Enriched Prompt:                    │
│ "You have 15 docs on React,         │
│  TypeScript. Classify relative      │
│  to KB size..."                     │
│                                     │
│ Makes KB-aware decision:            │
│ • Small KB + specific query → simple│
│ • Large KB + broad query → complex  │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│     KB-Aware Classification         │
│     (reasoning mentions KB)         │
└─────────────────────────────────────┘
```

## Data Dependencies

```
┌─────────────────────────────────────────────────────────┐
│                     Documents                           │
└─────────────────────────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────┐
         │   buildKBContext(documents)  │
         └──────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                    KBContext                            │
│  • documentCount, chunkCount                            │
│  • hasEmbeddings, embeddingCoverage                     │
│  • contentTypes: { code, prose, technical }             │
│  • topics, fingerprint                                  │
└─────────────────────────────────────────────────────────┘
                        ↓
         ┌──────────────────────────────┐
         │ createQueryExecutionContext  │
         └──────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│            QueryExecutionContext                        │
│  • kb: KBContext                                        │
│  • tokenBudget: { total, remaining, consumed, cost }    │
│  • timeBudget: { total, remaining, consumed, phases }   │
│  • phaseTimings: { classification, routing, ... }       │
│  • llmCalls: LLMCallMetadata[]                          │
│  • classification?: QueryClassification                 │
│  • routing?: RoutingDecision                            │
│  • validation?: ValidationResult                        │
│  • warnings: ExecutionWarning[]                         │
└─────────────────────────────────────────────────────────┘
                        ↓
              Passed to Agents
                        ↓
         ┌──────────────────────────┐
         │  Agent makes KB-aware    │
         │  decision                │
         └──────────────────────────┘
                        ↓
         ┌──────────────────────────┐
         │  recordPhaseTime()       │
         │  recordLLMCall()         │
         └──────────────────────────┘
                        ↓
         ┌──────────────────────────┐
         │  Context updated with    │
         │  agent results           │
         └──────────────────────────┘
                        ↓
         ┌──────────────────────────┐
         │  getExecutionSummary()   │
         └──────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│              ExecutionSummary                           │
│  • totalTokens, totalCost                               │
│  • llmCallCount, warningCount                           │
│  • budgetUtilization: { tokens, time }                  │
│  • phaseBreakdown: { classification: 1234, ... }        │
└─────────────────────────────────────────────────────────┘
                        ↓
         Returned in AgenticRAGResult
```

## Budget Tracking Flow

```
Initialize Context
  tokenBudget: { total: 50000, remaining: 50000, consumed: 0, cost: 0 }
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Agent 1: Classifier                                     │
│   LLM Call: 500 prompt + 150 completion = 650 tokens   │
│   Cost: $0.0195                                         │
│   ↓                                                     │
│ recordLLMCall(context, metadata)                        │
│   tokenBudget.consumed = 650                            │
│   tokenBudget.remaining = 49350                         │
│   tokenBudget.cost = $0.0195                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Agent 2: Router                                         │
│   LLM Call: 300 prompt + 100 completion = 400 tokens   │
│   Cost: $0.012                                          │
│   ↓                                                     │
│ recordLLMCall(context, metadata)                        │
│   tokenBudget.consumed = 1050                           │
│   tokenBudget.remaining = 48950                         │
│   tokenBudget.cost = $0.0315                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Agent 3-N: Continue pattern...                         │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Final Context State:                                    │
│   tokenBudget.consumed = 2500                           │
│   tokenBudget.remaining = 47500                         │
│   tokenBudget.cost = $0.075                             │
│   ↓                                                     │
│ Included in telemetry as:                               │
│   cumulativeTokens: 2500                                │
│   cumulativeCost: 0.075                                 │
│ ↓                                                       │
│ Included in executionSummary:                           │
│   totalTokens: 2500                                     │
│   totalCost: 0.075                                      │
│   budgetUtilization.tokens: 0.05 (5% of 50k)           │
└─────────────────────────────────────────────────────────┘
```

## Future: Budget Enforcement

```
┌─────────────────────────┐
│ Before Expensive Step   │
└─────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│ if (!canAffordTokens(context, 5000))│
│   skip expansion step               │
│   addWarning(context, 'expansion',  │
│     'budget_exceeded',              │
│     'Skipped expansion: low budget')│
│ }                                   │
└─────────────────────────────────────┘
           ↓
      Skip Phase
           ↓
   Continue Pipeline
```

## Key Takeaways

1. **KB Context flows from documents → context → agents**
2. **Execution context is the single source of truth**
3. **Phase timing recorded after each phase**
4. **Token/cost tracking cumulative throughout pipeline**
5. **Telemetry enriched at every step emission**
6. **Execution summary generated at end from context**
7. **Pattern is replicable for all agents**
