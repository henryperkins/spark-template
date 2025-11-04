# Visual Gap Analysis: Current vs. Target Implementation

This document provides a visual comparison of current vs. target implementation for key user flows.

---

## 1. Query Workflow Journey - Current vs. Target

### Current Implementation (As of 2025-11-03)

```
┌─────────────────────────────────────────────────────────────┐
│ QueryInterface                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Brain Icon] Ask Your Knowledge Base    [Switch] Enhanced│ │
│ │ ┌─────────────────────────────────────────────┐          │ │
│ │ │ [Input] Ask a question...            [Send] │          │ │
│ │ └─────────────────────────────────────────────┘          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌──────────────────────────────────────────┐                │
│ │ AgentWorkflowVisualizer (live, stacked)  │                │
│ │ ┌────────────────────────────────────┐   │                │
│ │ │ ● Classifier | running | 1.2s      │   │                │
│ │ │   └─ Simple • keyword  [View details]  │                │
│ │ │ ○ Router     | pending | —         │   │                │
│ │ │ ○ Retrieval  | pending | —         │   │                │
│ │ └────────────────────────────────────┘   │                │
│ └──────────────────────────────────────────┘                │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Conversation                                            │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ [You] What is retrieval?                            │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ [Assistant] Retrieval is...                         │ │ │
│ │ │                                                     │ │ │
│ │ │ [Quality Metrics]                                   │ │ │
│ │ │ Faithfulness: 85% | Relevance: 92% | Time: 3.2s    │ │ │
│ │ │                                                     │ │ │
│ │ │ [Workflow] 4 steps ▼                                │ │ │
│ │ │                                                     │ │ │
│ │ │ [Suggested Questions]                               │ │ │
│ │ │ • How does semantic search work?                    │ │ │
│ │ │ • What are embeddings?                              │ │ │
│ │ │                                                     │ │ │
│ │ │ [Sources] (3) ▼                                     │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

ISSUES:
✗ Single column layout (no sidebar)
✗ Workflow rail disappears after completion
✗ Quality metrics buried in message
✗ Suggested questions only after completion
✗ No Azure status indicator
✗ No fallback banner when degraded
✗ Only 4 status states (missing degraded, queued, skipped, idle)
```

---

### Target Implementation (From Enhancement Plan)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ QueryInterface (Desktop 2-column layout)                                        │
│ ┌────────────────────────────────────┬──────────────────────────────────────┐   │
│ │ LEFT: Conversation                 │ RIGHT: Sidebar (sticky)              │   │
│ │ ┌────────────────────────────────┐ │ ┌──────────────────────────────────┐ │   │
│ │ │ [Brain] Ask Your KB  [Enhanced]│ │ │ AzureServiceBadge                │ │   │
│ │ │ [Input] Ask...         [Send]  │ │ │ ● OpenAI: connected              │ │   │
│ │ └────────────────────────────────┘ │ │ ● Search: connected    [Retry]   │ │   │
│ │                                    │ └──────────────────────────────────┘ │   │
│ │ ┌────────────────────────────────┐ │                                      │   │
│ │ │ ⚠ FallbackBanner (if degraded) │ │ ┌──────────────────────────────────┐ │   │
│ │ │ LLM-only mode active.          │ │ │ AgentWorkflowVisualizer (live)   │ │   │
│ │ │ [Retry] [Learn More] [Dismiss] │ │ │ ┌────────────────────────────┐   │ │   │
│ │ └────────────────────────────────┘ │ │ │ ● Classifier | completed  │   │ │   │
│ │                                    │ │ │   └─ Complex • multi-step │   │ │   │
│ │ ┌────────────────────────────────┐ │ │ │     [Explain this step] 🛈│   │ │   │
│ │ │ [You] Compare architecture...  │ │ │ │ ⚙ Planner | running        │   │ │   │
│ │ └────────────────────────────────┘ │ │ │   └─ 3 sub-queries         │   │ │   │
│ │                                    │ │ │     [Show plan]            │   │ │   │
│ │ ┌────────────────────────────────┐ │ │ │ ○ Router | queued          │   │ │   │
│ │ │ [Assistant] Based on...        │ │ │ │ ○ Retrieval | queued       │   │ │   │
│ │ │                                │ │ │ └────────────────────────────┘   │ │   │
│ │ │ [Post-Run Summary] ✨          │ │ │ [View Telemetry] 📊              │ │   │
│ │ │ ⏱ 4.2s | 🪙 1.2k tokens       │ │ └──────────────────────────────────┘ │   │
│ │ │ 💰 $0.003 | Mode: hybrid       │ │                                      │   │
│ │ │ 📊 Coverage: 12/47 docs        │ │ ┌──────────────────────────────────┐ │   │
│ │ │ 🆔 run-abc123 [Copy] [Export]  │ │ │ SuggestedQuestions (contextual)  │ │   │
│ │ │ [Explain changes] ▼            │ │ │ Top 3 next:                      │ │   │
│ │ └────────────────────────────────┘ │ │ • deeper: What changed in...     │ │   │
│ │                                    │ │ • related: Show differences...   │ │   │
│ │ [CriticCallout]                    │ │ • clarification: Which version...│ │   │
│ │ ✓ Passed | Confidence: High        │ │ [Cached] ⚡                      │ │   │
│ │ Faithfulness: 87% | Relevance: 94% │ └──────────────────────────────────┘ │   │
│ │ [Sources] (8) ▼                    │ │                                      │   │
│ └────────────────────────────────────┴──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘

IMPROVEMENTS:
✓ 2-column desktop layout
✓ Sticky sidebar with live workflow
✓ AzureServiceBadge with real-time status
✓ FallbackBanner when degraded
✓ Contextual suggested questions during run
✓ Post-run summary with trace ID
✓ CriticCallout extracted
✓ 7 status states including degraded
✓ Telemetry drawer access
✓ Tooltips on steps
```

---

## 2. Status State Taxonomy - Current vs. Target

### Current (4 States)

```
┌──────────┬─────────────┬──────────────────┬────────────────────┐
│ Status   │ Icon        │ Visual           │ When Used          │
├──────────┼─────────────┼──────────────────┼────────────────────┤
│ pending  │ ⏱ Clock     │ gray border      │ Not started        │
│ running  │ ▶ PlayCircle│ amber, pulsing   │ Currently executing│
│ completed│ ✓ CheckCircle│ green            │ Successfully done  │
│ failed   │ ⚠ Warning   │ red              │ Error occurred     │
└──────────┴─────────────┴──────────────────┴────────────────────┘

LIMITATIONS:
✗ No way to show "waiting in queue" vs "never scheduled"
✗ Azure fallback looks like success (completed) instead of degraded
✗ Can't distinguish skipped steps (e.g., ReAct not needed)
✗ No idle state for pre-initialization
```

---

### Target (7 States)

```
┌──────────┬─────────────┬──────────────────┬────────────────────────────────────┐
│ Status   │ Icon        │ Visual           │ When Used                          │
├──────────┼─────────────┼──────────────────┼────────────────────────────────────┤
│ idle     │ ○ Circle    │ muted, no border │ Pre-initialization, not applicable │
│ queued   │ ⏳ Hourglass│ blue, subtle ring│ Waiting in queue for execution     │
│ running  │ ▶ PlayCircle│ amber, pulsing   │ Currently executing                │
│ completed│ ✓ Check     │ emerald          │ Successfully completed             │
│ failed   │ ✗ X         │ destructive red  │ Error occurred, blocked            │
│ skipped  │ ⏭ FastForward│ gray, dashed    │ Intentionally skipped (e.g. ReAct) │
│ degraded │ ⚠ Warning   │ yellow-600/30    │ Completed but with fallback/limits │
└──────────┴─────────────┴──────────────────┴────────────────────────────────────┘

BENEFITS:
✓ Clear distinction between "not yet" (queued) and "never" (idle/skipped)
✓ Azure fallback visible as degraded, not hidden success
✓ Users understand when steps are intentionally bypassed
✓ Consistent color language across all components
```

---

## 3. Telemetry - Current vs. Target

### Current (Event Emission Only)

```
┌────────────────────────────────────────────────────┐
│ Orchestrator                                       │
│   └─> emitStepEvent()                              │
│         └─> telemetry.trackAgentStep()             │
│               └─> window.spark.telemetry.track()   │
│               └─> console.debug() [dev only]       │
└────────────────────────────────────────────────────┘

EVENT PAYLOAD (Current):
{
  type: 'agent_step_status',
  runId: 'run-abc123',
  query: 'What is RAG?',
  agent: 'Classifier',
  action: 'Classify query complexity',
  status: 'completed',
  stepIndex: 0,
  duration: 1200,
  timestamp: '2025-11-03T10:30:00.000Z'
  // ✗ No tokens/cost
  // ✗ No source counts
  // ✗ No Azure availability
  // ✗ No fallback mode
}

STORAGE:
✗ Events only sent to external sink or console
✗ No persistence (lost on page refresh)
✗ No UI to view history
```

---

### Target (KV-Persisted + Drawer)

```
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator                                                │
│   └─> emitStepEvent()                                       │
│         └─> telemetry.trackAgentStep()                      │
│               ├─> window.spark.telemetry.track()            │
│               ├─> console.debug() [dev only]                │
│               └─> persistToKV(event) ✨ NEW                 │
│                     └─> useSparkKV('telemetry:session:...')│
└─────────────────────────────────────────────────────────────┘

EVENT PAYLOAD (Enhanced):
{
  type: 'agent_step_status',
  runId: 'run-abc123',
  query: 'What is RAG?',
  agent: 'Classifier',
  action: 'Classify query complexity',
  status: 'completed',
  stepIndex: 0,
  duration: 1200,
  timestamp: '2025-11-03T10:30:00.000Z',

  // ✓ NEW FIELDS:
  inputTokens: 120,
  outputTokens: 80,
  costUSD: 0.0012,
  sourceCounts: { docs: 3, chunks: 8 },
  azureAvailability: { openai: true, search: true },
  planStepId: null,
  errorCode: null,
  fallbackMode: 'none'
}

STORAGE:
✓ Persisted to KV with ring buffer (500 events max)
✓ Session-based: telemetry:session:{sessionId}:events
✓ Survives page refresh
✓ TelemetryDrawer UI for viewing/filtering/exporting

┌────────────────────────────────────────────┐
│ TelemetryDrawer                            │
│ ┌────────────────────────────────────────┐ │
│ │ Telemetry Events (Last 500)            │ │
│ │ [Filters] Agent: All | Status: All     │ │
│ │ ┌────────────────────────────────────┐ │ │
│ │ │ Classifier | completed | 1.2s      │ │ │
│ │ │ 🪙 200 tokens | 💰 $0.0012         │ │ │
│ │ │ ✓ Azure: all connected             │ │ │
│ │ ├────────────────────────────────────┤ │ │
│ │ │ Retrieval | degraded | 2.1s       │ │ │
│ │ │ 🪙 0 tokens | 💰 $0.00             │ │ │
│ │ │ ⚠ Fallback: local-only             │ │ │
│ │ └────────────────────────────────────┘ │ │
│ │ [Export JSON] [Clear History]          │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

---

## 4. Azure Integration - Current vs. Target

### Current (Silent Failure)

```
┌─────────────────────────────────────────────────────────┐
│ When Azure is offline:                                  │
│                                                         │
│ 1. findRelevantChunks() tries Azure Search             │
│ 2. Error caught silently                               │
│ 3. Falls back to findRelevantChunksLocal()             │
│ 4. Returns results                                     │
│ 5. Step marked "completed" ✓                           │
│                                                         │
│ USER SEES:                                              │
│ ● Retrieval | completed | 2.3s                         │
│                                                         │
│ ✗ No indication Azure failed                           │
│ ✗ No retry option                                      │
│ ✗ No explanation of degraded quality                   │
└─────────────────────────────────────────────────────────┘
```

---

### Target (Transparent Degradation)

```
┌─────────────────────────────────────────────────────────────┐
│ When Azure is offline:                                      │
│                                                             │
│ 1. AzureServiceBadge shows real-time status                 │
│    ● OpenAI: error ⚠                                        │
│    ● Search: disconnected ✗  [Retry]                        │
│                                                             │
│ 2. FallbackBanner appears at top of QueryInterface          │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ ⚠ Degraded Mode: LOCAL-ONLY                         │ │
│    │ Azure services are offline. Using local processing. │ │
│    │ Results may be less accurate than hybrid search.    │ │
│    │ [Retry Connection] [Learn More] [Dismiss]           │ │
│    └─────────────────────────────────────────────────────┘ │
│                                                             │
│ 3. findRelevantChunks() tries Azure Search                  │
│ 4. Error caught                                             │
│ 5. Falls back to findRelevantChunksLocal()                  │
│ 6. Step emits status: 'degraded' ⚠                          │
│ 7. Returns results                                          │
│                                                             │
│ USER SEES:                                                  │
│ ⚙ Retrieval | degraded | 2.3s                              │
│   └─ hybrid search (degraded: Azure offline) ⚠             │
│   [Explain this step] 🛈                                    │
│                                                             │
│ TELEMETRY EVENT:                                            │
│ {                                                           │
│   status: 'degraded',                                       │
│   fallbackMode: 'local-only',                               │
│   azureAvailability: { openai: false, search: false }       │
│ }                                                           │
│                                                             │
│ ✓ User knows degraded mode is active                        │
│ ✓ Retry option available                                   │
│ ✓ Explanation of limitations                               │
│ ✓ Full transparency in telemetry                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Document Upload Pipeline - Current vs. Target

### Current (Linear Progress Bar)

```
┌────────────────────────────────────────────────────┐
│ Upload Progress                                    │
│ ┌────────────────────────────────────────────────┐ │
│ │ 📄 document.txt                                │ │
│ │ Generating embeddings               [90%]     │ │
│ │ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░         │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘

ISSUES:
✗ Can't see individual pipeline stages
✗ No stage-specific retry
✗ Unclear what "90%" means (which stage?)
✗ If embedding fails, entire upload marked error
```

---

### Target (IngestionStepper)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Upload Progress                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ document.txt                                                             │ │
│ │ ┌────────────────────────────────────────────────────────────────────┐   │ │
│ │ │ [Connect]  [Fetch]  [Parse]  [Chunk]  [Embed]  [Index]  [Ready]   │   │ │
│ │ │    ✓          ✓        ✓        ✓       ⚙        ○        ○        │   │ │
│ │ │                                       [90%]                         │   │ │
│ │ │                                    [Retry] 🛈                       │   │ │
│ │ └────────────────────────────────────────────────────────────────────┘   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ [Mobile: Horizontal scroll with snap-x]                                     │
│ ← [Connect] [Fetch] [Parse] [Chunk] [Embed] [Index] [Ready] →              │
└──────────────────────────────────────────────────────────────────────────────┘

IMPROVEMENTS:
✓ Clear stage visibility (7 stages)
✓ Per-stage status badges
✓ Retry button on failed stage
✓ Tooltips explaining each stage
✓ Partial completion handling (can see "Chunk succeeded, Embed failed")
✓ Mobile-friendly horizontal scroll
```

---

## 6. Suggested Questions - Current vs. Target

### Current (Post-Completion Only)

```
┌─────────────────────────────────────────┐
│ Timeline:                               │
│                                         │
│ 0s  User submits query                  │
│ 1s  Classifier completes                │
│     └─> (questions generated but hidden)│
│ 2s  Planner completes                   │
│     └─> (questions refined but hidden)  │
│ 3s  Retrieval completes                 │
│ 4s  Generator completes                 │
│ 5s  Expansion completes                 │
│     └─> SuggestedQuestions SHOWN ✓      │
│                                         │
│ ✗ User waits 5s to see suggestions      │
│ ✗ Can't start next query while waiting │
└─────────────────────────────────────────┘
```

---

### Target (Contextual Display During Run)

```
┌───────────────────────────────────────────────────────────┐
│ Timeline:                                                 │
│                                                           │
│ 0s  User submits query                                    │
│ 1s  Classifier completes                                  │
│     └─> Top 3 questions shown ✨ (mini-rail, disabled)    │
│         ┌─────────────────────────────────────────────┐   │
│         │ Quick suggestions:                          │   │
│         │ • clarification: Do you mean...? [disabled] │   │
│         │ • related: Also check... [disabled]         │   │
│         │ • deeper: Why does... [disabled]            │   │
│         └─────────────────────────────────────────────┘   │
│ 2s  Planner completes                                     │
│     └─> Questions refined (still disabled)                │
│ 3s  Retrieval completes                                   │
│ 4s  Generator completes                                   │
│ 5s  Expansion completes                                   │
│     └─> SuggestedQuestions ENABLED ✓ (clickable)          │
│                                                           │
│ ✓ User sees suggestions immediately after 1s              │
│ ✓ Can plan next query while waiting                      │
│ ✓ Context-aware based on classification                  │
└───────────────────────────────────────────────────────────┘
```

---

## 7. Accessibility - Current vs. Target

### Current (Partial Support)

```
✓ Radix UI primitives (keyboard nav on tabs, accordions)
✓ Some ARIA labels on badges
✓ Focus visible styles via Tailwind

✗ No keyboard nav for step rail
✗ No live announcements
✗ No focus management on errors
✗ Animations run even with prefers-reduced-motion
✗ Missing semantic landmarks (main, nav, aside)
✗ Some buttons below 44px touch target
```

---

### Target (Full A11y Compliance)

```
✓ KEYBOARD NAVIGATION:
  - Step rail: Left/Right arrows to navigate, Enter to expand
  - Escape closes drawers/popovers
  - Tab order logical and complete

✓ ARIA LIVE REGIONS:
  <div aria-live="polite" className="sr-only">
    Router selected hybrid strategy with 82% confidence
  </div>

✓ FOCUS MANAGEMENT:
  - Move focus to first failing step on error
  - Trap focus in open drawer
  - Return focus to trigger after closing

✓ REDUCED MOTION:
  className="motion-reduce:transition-none motion-reduce:animate-none"

✓ SEMANTIC HTML:
  <main>, <nav>, <aside>, proper heading hierarchy

✓ TOUCH TARGETS:
  All interactive elements >= 44x44px on mobile

✓ TESTING:
  - axe DevTools: 0 critical violations
  - Screen reader: Full workflow navigable
  - Keyboard only: All features accessible
```

---

## 8. Implementation Priority Matrix

```
┌────────────────────────────────────────────────────────────────┐
│                       IMPACT vs. EFFORT                        │
│                                                                │
│ HIGH IMPACT                                                    │
│ ▲                                                              │
│ │  ┌───────────────────┐     ┌──────────────────┐             │
│ │  │ Status Taxonomy   │     │ Telemetry Drawer │             │
│ │  │ + Degraded State  │     │ + KV Persistence │             │
│ │  │ PRIORITY 1        │     │ PRIORITY 2       │             │
│ │  └───────────────────┘     └──────────────────┘             │
│ │                                                              │
│ │  ┌──────────────────┐      ┌──────────────────┐             │
│ │  │ Azure Badges +   │      │ Post-Run Summary │             │
│ │  │ Fallback Banner  │      │ + Trace ID       │             │
│ │  │ PRIORITY 3       │      │ PRIORITY 7       │             │
│ │  └──────────────────┘      └──────────────────┘             │
│ │                                                              │
│ │  ┌──────────────────┐                                       │
│ │  │ Ingestion Stepper│      ┌──────────────────┐             │
│ │  │ PRIORITY 4       │      │ Accessibility    │             │
│ │  └──────────────────┘      │ PRIORITY 9       │             │
│ │                            └──────────────────┘             │
│ │                                                              │
│ │  ┌──────────────────┐                                       │
│ │  │ Contextual       │                                       │
│ │  │ Suggestions      │      ┌──────────────────┐             │
│ │  │ PRIORITY 6       │      │ DocumentList     │             │
│ │  └──────────────────┘      │ Scalability      │             │
│ │                            │ PRIORITY 10      │             │
│ │                            └──────────────────┘             │
│ └────────────────────────────────────────────────────────────▶│
│                                              HIGH EFFORT       │
│ LOW IMPACT                                                     │
│ │  ┌──────────────────┐      ┌──────────────────┐             │
│ │  │ Sticky Nav       │      │ CriticCallout    │             │
│ │  │ PRIORITY 8       │      │ Extraction       │             │
│ │  └──────────────────┘      │ PRIORITY 5       │             │
│ │                            └──────────────────┘             │
│ ▼                                                              │
└────────────────────────────────────────────────────────────────┘

Legend:
- Top-left: Quick wins (do first)
- Top-right: Major features (plan carefully)
- Bottom-left: Nice-to-haves (if time permits)
- Bottom-right: Long-term investments
```

---

## 9. File Creation Checklist

### New Components to Create:

```
□ src/components/TelemetryDrawer.tsx
□ src/components/AzureServiceBadge.tsx
□ src/components/FallbackBanner.tsx
□ src/components/IngestionStepper.tsx
□ src/components/CriticCallout.tsx (extract from AgentWorkflowVisualizer)
□ src/components/PostRunSummary.tsx
□ src/components/StatusBadge.tsx (optional refactor)
□ src/components/StepChip.tsx (optional refactor)
□ src/components/EmptyState.tsx (optional refactor)
```

### Files to Modify:

```
□ src/lib/agents/orchestrator.ts
  - Extend status union to 7 states (line 20)
  - Emit degraded status on Azure fallback (line 378)
  - Add token/cost tracking to emitStepEvent

□ src/components/AgentWorkflowVisualizer.tsx
  - Add 3 new STATUS_META entries (line 48)
  - Add tooltips with Tooltip component
  - Add keyboard navigation
  - Add ARIA live announcements

□ src/components/QueryInterface.tsx
  - Implement 2-column layout
  - Add AzureServiceBadge to header
  - Add FallbackBanner when degraded
  - Add PostRunSummary card
  - Add contextual SuggestedQuestions

□ src/lib/services/telemetry.ts
  - Add KV persistence layer
  - Extend AgentStepEvent interface with new fields
  - Add ring buffer logic (max 500 events)

□ src/lib/azure-service-manager.ts
  - Implement real connection testing (line 218)
  - Add retry logic with backoff
  - Add status refresh interval

□ src/components/DocumentUpload.tsx
  - Integrate IngestionStepper
  - Add per-stage retry

□ src/components/Integrations.tsx
  - Integrate IngestionStepper
  - Add AzureServiceBadge to each tab

□ src/components/ResponsiveNavigation.tsx
  - Make TabsList sticky (line 33)
  - Add overflow-x handling
```

### Testing Files to Create:

```
□ src/components/__tests__/TelemetryDrawer.test.tsx
□ src/components/__tests__/AzureServiceBadge.test.tsx
□ src/components/__tests__/FallbackBanner.test.tsx
□ src/components/__tests__/IngestionStepper.test.tsx
□ src/lib/agents/__tests__/orchestrator-degraded.test.ts
□ e2e/keyboard-navigation.spec.ts
□ e2e/azure-fallback.spec.ts
```

---

## 10. Next Steps

1. **Review this document** with stakeholders/team
2. **Prioritize enhancements** based on user feedback
3. **Start with Phase 1** (Status Taxonomy, Azure Badges, Telemetry KV)
4. **Set up testing infrastructure** (jest-axe, Playwright)
5. **Implement iteratively** with user testing after each phase
6. **Measure impact** (abandonment rates, SUS scores, A11y violations)

---

**Document Version:** 1.0
**Last Updated:** 2025-11-03
**Maintained by:** Engineering Team
