# Observability Layer - Complete Implementation Guide

## Purpose
- Provide actionable visibility into agent workflow health, latency, cost, and reliability
- Enable rapid debugging of parse errors and prompt regressions
- Protect user privacy by default via redaction and hashing
- Track and control LLM token consumption and costs
- Systematically monitor and classify system errors
- Provide real-time alerting for operational issues
 
Runtime notes:
- Client telemetry posts to `/api/telemetry` (configurable via `VITE_ANALYTICS_ENDPOINT`).
- Worker emits structured logs and can stream to R2 (`LOGS` binding).

---

## Implementation Status

### ✅ Implemented & Production-Ready
- **Workflow Tracking** - Real-time agent step visualization with status tracking
- **Performance Timing** - Per-step duration tracking with millisecond precision
- **Cache Monitoring** - Hit rate, TTL distribution, invalidation history
- **Quality Metrics** - Faithfulness and relevance scoring via Critic Agent
- **Telemetry Service** - Multi-sink event tracking with graceful degradation
- **Agent Analytics** - Alert thresholds and failure tracking

### 🚀 Sprint 1 Priorities (Critical Gaps)
These features are documented below but require implementation:
1. **Token & Cost Tracking** - Monitor LLM spending and budget limits
2. **Error Rate Dashboard** - Systematic error aggregation and classification
3. **Alert UI** - Toast notifications for operational visibility

### 📋 Future Enhancements
- Historical metrics persistence (Phase 2)
- P50/P95/P99 latency percentiles
- Waterfall visualization for agent workflows
- Custom metrics API

> **Note:** For historical implementation review, see [archive/observability-layer-review-2025-01.md](./archive/observability-layer-review-2025-01.md)

---

## Architecture Overview

### Core Services

#### 1. Token Tracking Service
**File:** [`src/lib/services/token-tracker.ts`](src/lib/services/token-tracker.ts)

**Purpose:** Monitor LLM token usage and estimate costs with budget management

**Key Features:**
- Model-specific pricing (GPT-4: $0.03/$0.06, GPT-4 Turbo: $0.01/$0.03, GPT-3.5: $0.0005/$0.0015)
- Daily budget tracking with configurable limits and thresholds
- Token estimation for prompts and completions
- Usage metrics grouped by model
- Persistent daily usage tracking via Cloudflare KV (with in-memory fallback)
- In-memory metrics retention (last 1000 requests)
- Safe storage abstraction compatible with Cloudflare Worker environment

**API Interface:**
```typescript
interface LLMUsageMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  modelUsed: string
  timestamp: string
  provider: 'azure' | 'worker'
}

// Record usage
tokenTracker.recordUsage({
  promptTokens: 150,
  completionTokens: 300,
  totalTokens: 450,
  modelUsed: 'gpt-4',
  provider: 'azure',
  timestamp: new Date().toISOString()
})

// Get daily usage (synchronous)
const usage = tokenTracker.getDailyUsage()
// Returns: { tokens: number, cost: number, queryCount: number }

// Check budget status (async for Spark KV)
const budget = await tokenTracker.getBudgetStatus()
// Returns: {
//   dailyLimit, currentUsage, percentageUsed,
//   remainingTokens, isNearLimit, isOverLimit
// }

// Get usage by model
const byModel = tokenTracker.getMetricsByModel()
// Returns: Record<string, { count, totalTokens, totalCost }>
```

**Integration Points:**
- **LLM Service:** [`src/lib/services/llm-service.ts`](src/lib/services/llm-service.ts:4-5)
  - Integrated into `generateText()` at line 119
  - Integrated into `generateRawJson()` at line 162
  - Uses `estimateTokens()` from [`prompt-utils.ts`](src/lib/prompt-utils.ts:50)

**Storage Architecture:**
- **Primary:** Spark KV (`window.spark.kv`) for persistent budget tracking
- **Fallback:** In-memory Map when Spark KV unavailable
- **Safety:** All storage operations wrapped in try-catch to prevent LLM call failures
- **Async:** Budget persistence is non-blocking (`void` promise)

**Configuration:**
```typescript
// Set daily token limit
tokenTracker.setDailyLimit(1000000) // 1M tokens

// Set alert threshold (percentage)
tokenTracker.setAlertThreshold(80) // Alert at 80%
```

**Data Flow:**
```
LLM Request → Token Estimation (prompt) → LLM Response → Token Estimation (completion)
     ↓
trackTokenUsage() → tokenTracker.recordUsage()
     ↓
Store in memory + Spark KV (daily budget, non-blocking) → UI Dashboard
     ↓
Safe storage: Try Spark KV → Fallback to in-memory on error
```

---

#### 2. Error Tracking Service
**File:** [`src/lib/services/error-tracker.ts`](src/lib/services/error-tracker.ts)

**Purpose:** Systematic error classification, aggregation, and analysis

**Key Features:**
- Automatic error type classification (retrieval, llm, embedding, cache, network, unknown)
- Error rate calculation (errors per hour)
- Error aggregation by type and agent
- Recent error history (last 10 errors)
- Error trend analysis (increasing/decreasing/stable)
- In-memory retention (last 500 errors)

**API Interface:**
```typescript
interface ErrorEvent {
  errorId: string
  type: 'retrieval' | 'llm' | 'embedding' | 'cache' | 'network' | 'unknown'
  message: string
  stack?: string
  agent?: string
  query?: string
  code?: string
  timestamp: string
}

// Record an error
errorTracking.record(error, {
  type: 'retrieval',
  agent: 'Retrieval',
  query: 'user query',
  code: 'RETRIEVAL_FALLBACK'
})

// Get error metrics
const metrics = errorTracking.getMetrics()
// Returns: {
//   totalErrors: number
//   errorRate: number // errors per hour
//   byType: Record<ErrorType, number>
//   recentErrors: ErrorEvent[]
//   errorsByAgent: Record<string, number>
// }

// Check error rate threshold
const isHigh = errorTracking.isErrorRateHigh(5) // threshold = 5

// Get error trend
const trend = errorTracking.getErrorRateTrend()
// Returns: 'increasing' | 'decreasing' | 'stable'
```

**Integration Points:**
- **Orchestrator:** [`src/lib/agents/orchestrator.ts`](src/lib/agents/orchestrator.ts:12)
  - Integrated into `executeStep()` catch block (line 241)
  - Integrated into `executeRetrieval()` fallback (line 372)
  - Automatic agent context tracking

**Error Classification Logic:**
```typescript
// Automatic classification based on error message/name
'fetch' or 'network' → 'network'
'llm' or 'generate' or 'completion' → 'llm'
'retrieval' or 'search' → 'retrieval'
'embedding' or 'vector' → 'embedding'
'cache' → 'cache'
default → 'unknown'
```

---

#### 3. Alert Management System

**Toast Notifications:**
**File:** [`src/lib/services/agent-analytics.ts`](src/lib/services/agent-analytics.ts)

**Features:**
- Real-time toast notifications using Sonner library
- Error toasts for step failures (5 second duration, error severity)
- Warning toasts for slow steps >15s (4 second duration, warning severity)
- Formatted messages with timing and failure context

**Implementation:**
```typescript
// In raiseAlert() method
private showAlertToast(alert: {
  agent: string
  action: string
  code: AgentAlertCode
  severity: 'warning' | 'error'
  duration?: number
  failureReason?: string
}): void {
  if (alert.severity === 'error') {
    toast.error(`Agent Error: ${alert.agent}`, {
      description: formatAlertMessage(alert),
      duration: 5000
    })
  } else {
    toast.warning(`Slow Step: ${alert.agent}`, {
      description: formatAlertMessage(alert),
      duration: 4000
    })
  }
}
```

**Alert Panel Component:**
**File:** [`src/components/AlertPanel.tsx`](src/components/AlertPanel.tsx)

**Features:**
- Persistent alert storage via SparkKV
- Acknowledge/dismiss individual alerts
- Acknowledge all or clear all functionality
- Unacknowledged alert counter badge
- Auto-cleanup of acknowledged alerts after 1 hour
- Real-time updates
- Color-coded severity indicators (🔴 error, ⚠️ warning)

**Data Model:**
```typescript
interface SystemAlert {
  id: string
  severity: 'warning' | 'error'
  code: string
  agent?: string
  message: string
  timestamp: string
  acknowledged: boolean
}
```

**State Management:**
- Uses `useSparkKV('system-alerts', [])` for persistence
- Survives page refreshes
- Syncs across browser tabs (Spark KV feature)

**Auto-Cleanup:**
```typescript
// Runs every minute
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000
  setAlerts(alerts.filter(alert =>
    !alert.acknowledged ||
    new Date(alert.timestamp).getTime() > oneHourAgo
  ))
}, 60000)
```

---

### UI Components

#### ScalingDashboard Component
**File:** [`src/components/ScalingDashboard.tsx`](src/components/ScalingDashboard.tsx)

**Structure:**
```
AlertPanel (persistent alerts at top)
     ↓
TabsList (5 tabs)
  ├─ Embeddings (existing)
  ├─ Cache (existing)
  ├─ Costs (NEW)
  ├─ Errors (NEW)
  └─ Metrics (existing)
```

**Costs Tab Features:**
- Today's token usage and cost display
- Queries processed count
- Daily budget status with progress bar
- Budget alerts (warning when >80% used)
- Usage breakdown by model (count, tokens, cost)
- Real-time updates (every 5 seconds)

**Errors Tab Features:**
- Error rate (last hour) with critical threshold alerts
- Total error count
- Error breakdown by type with counts
- Error breakdown by agent with counts
- Recent errors (last 10) with:
  - Error type badge
  - Agent badge
  - Timestamp
  - Error message
  - Error code
- Auto-scrolling error list

**Auto-Refresh:**
```typescript
useEffect(() => {
  loadMetrics()
  const interval = setInterval(loadMetrics, 5000) // 5 seconds
  return () => clearInterval(interval)
}, [documents])
```

---

## Core Files Reference

### Services
- [`src/lib/services/telemetry.ts`](src/lib/services/telemetry.ts) - Event emission to Spark analytics
- [`src/lib/services/agent-analytics.ts`](src/lib/services/agent-analytics.ts) - Alert thresholds and toast notifications
- [`src/lib/services/token-tracker.ts`](src/lib/services/token-tracker.ts) - Token usage and cost tracking
- [`src/lib/services/error-tracker.ts`](src/lib/services/error-tracker.ts) - Error classification and aggregation
- [`src/lib/services/llm-service.ts`](src/lib/services/llm-service.ts) - Token tracking integration
- [`src/lib/services/analytics-backend.ts`](src/lib/services/analytics-backend.ts) - External analytics backend

### Agents
- [`src/lib/agents/orchestrator.ts`](src/lib/agents/orchestrator.ts) - Workflow tracking and error integration

### Utilities
- [`src/lib/prompt-utils.ts`](src/lib/prompt-utils.ts) - Token estimation and sanitization
- [`src/lib/cache-manager.ts`](src/lib/cache-manager.ts) - Cache metrics
- [`src/lib/config.ts`](src/lib/config.ts) - Configuration management

### Components
- [`src/components/ScalingDashboard.tsx`](src/components/ScalingDashboard.tsx) - Main observability dashboard
- [`src/components/AlertPanel.tsx`](src/components/AlertPanel.tsx) - Persistent alert management
- [`src/components/AgentWorkflowVisualizer.tsx`](src/components/AgentWorkflowVisualizer.tsx) - Real-time workflow visualization

---

## Signals and Metrics

### Agent Step Status Events
Emitted at the start and end of each agent step via orchestrator.

**Fields:**
- `runId` - Correlation ID per query (UUID)
- `agent` - Classifier, Planner, Router, Retrieval, Generator, Critic, ReAct, Expansion
- `action` - Human-readable step description
- `status` - running, completed, failed
- `stepIndex` - 0-based index in workflow
- `duration` - Milliseconds (on completed/failed)
- `failureReason` - Error message (on failed)
- `timestamp` - ISO-8601 format
- `query` - User query (optional, may be redacted)

### Token and Cost Metrics (IMPLEMENTED)
**Source:** [`token-tracker.ts`](src/lib/services/token-tracker.ts)

**Real-time tracking:**
- `promptTokens` - Estimated from prompt length
- `completionTokens` - Estimated from completion length
- `totalTokens` - Sum of prompt + completion
- `estimatedCost` - Tokens × model pricing
- `modelUsed` - Model identifier
- `provider` - 'azure' or 'spark'

**Aggregated metrics:**
- Daily total tokens and cost
- Token usage per model
- Query count
- Budget status (limit, usage, remaining)

### Error Metrics (IMPLEMENTED)
**Source:** [`error-tracker.ts`](src/lib/services/error-tracker.ts)

**Tracked:**
- `errorRate` - Errors per hour
- `totalErrors` - All-time count (with 500 limit)
- `byType` - Count per error type
- `byAgent` - Count per agent
- `recentErrors` - Last 10 errors with full details
- `errorTrend` - Increasing/decreasing/stable

### Cache Metrics (EXISTING)
**Source:** [`cache-manager.ts`](src/lib/cache-manager.ts)

- Hit rate percentage
- Miss rate percentage
- Total cached keys
- Stale entry count
- Average entry age
- TTL distribution (short/medium/long/very long)
- Recent invalidations with type and reason

### Validation Metrics (EXISTING)
**Source:** [`critic-agent.ts`](src/lib/agents/critic-agent.ts)

- `faithfulnessScore` - 0-1 scale, grounding in sources
- `relevanceScore` - 0-1 scale, alignment with query
- `isValid` - Boolean quality gate
- `issues` - Array of specific problems
- `suggestions` - Array of improvement recommendations

### Refinement Metrics (EXISTING)
**Source:** [`react-agent.ts`](src/lib/agents/react-agent.ts)

- `iterations` - Actual refinement cycles
- `improved` - Boolean success indicator
- `issues_reduced_count` - Delta in issue count

---

## Data Contracts

### token_usage_metrics
```typescript
{
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  modelUsed: string
  provider: 'azure' | 'spark'
  timestamp: string // ISO-8601
}
```

### error_event
```typescript
{
  errorId: string // UUID
  type: 'retrieval' | 'llm' | 'embedding' | 'cache' | 'network' | 'unknown'
  message: string
  stack?: string
  agent?: string
  query?: string
  code?: string
  timestamp: string // ISO-8601
}
```

### system_alert
```typescript
{
  id: string // UUID
  severity: 'warning' | 'error'
  code: string
  agent?: string
  message: string
  timestamp: string // ISO-8601
  acknowledged: boolean
}
```

### agent_step_status
```typescript
{
  event: 'agent_step_status'
  runId: string
  query: string
  agent: string
  action: string
  status: 'running' | 'completed' | 'failed'
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}
```

### agent_step_alert
```typescript
{
  event: 'agent_step_alert'
  runId: string
  query: string
  agent: string
  action: string
  severity: 'warning' | 'error'
  code: 'long_running_step' | 'step_failure'
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}
```

---

## Alert Policies

### Operational Alerts (IMPLEMENTED)

**Long Running Steps:**
- Threshold: 15 seconds
- Severity: Warning
- Notification: Toast (4 seconds) + AlertPanel
- Message: "{action} took {duration}s (threshold: 15s)"

**Step Failures:**
- Threshold: 1 consecutive failure
- Severity: Error
- Notification: Toast (5 seconds) + AlertPanel
- Message: "{agent}: {failureReason}"

**High Error Rate:**
- Threshold: >5 errors per hour
- Severity: Warning
- Notification: Alert banner in Errors tab
- Message: "Error rate is above normal threshold"

**Budget Alerts:**
- Near limit: 80% of daily budget
- Severity: Warning
- Notification: Alert banner in Costs tab
- Message: "Approaching Budget Limit - {percentage}% used"

**Recommended Additional Policies:**

**Availability:**
- Failure rate > 5% over 10 minutes (warn)
- Failure rate > 10% over 10 minutes (critical)

**Latency:**
- P95 total duration > 15s (warn)
- P95 total duration > 25s (critical)
- Any single step P95 > 8s (warn)

**Parse Integrity:**
- JSON parse failure (EPARSE) > 2% (warn)
- JSON parse failure (EPARSE) > 5% (critical)

**Rate Limits:**
- ERATELIMIT events > 2 per minute for 10 minutes (warn)

**Validation Quality:**
- Average faithfulnessScore < 0.7 for 10 minutes (warn)

---

## Runbook

### Operational Issues

#### High Token Costs
**Symptoms:**
- Daily budget near limit or exceeded
- Unexpected cost spike

**Investigation:**
1. Check Costs tab → Usage by Model
2. Identify which model is consuming most tokens
3. Review recent queries for complexity
4. Check `tokenTracker.getDailyUsage()` for query count

**Resolution:**
- Lower daily budget limit: `tokenTracker.setDailyLimit(newLimit)`
- Switch to cheaper model (gpt-3.5-turbo vs gpt-4)
- Reduce max tokens per request in config
- Enable more aggressive caching

#### High Error Rate
**Symptoms:**
- Error rate > 5 per hour
- Multiple agent failures

**Investigation:**
1. Check Errors tab → Error Types breakdown
2. Check Errors tab → Errors by Agent
3. Review Recent Errors for patterns
4. Check `errorTracking.getErrorRateTrend()`

**Resolution:**
- Network errors: Check provider status, verify connectivity
- LLM errors: Review prompt templates, check API keys
- Retrieval errors: Verify document index, check Azure config
- Cache errors: Clear stale entries, reset cache

#### Slow Agent Steps
**Symptoms:**
- Toast warnings for slow steps
- Step duration > 15 seconds

**Investigation:**
1. Identify slow agent from toast notification
2. Check AgentWorkflowVisualizer for step durations
3. Review step complexity (sub-queries, token count)

**Resolution:**
- Retrieval: Reduce `maxResults`, enable `dedupeByDocument`
- LLM: Reduce `maxTokens`, lower temperature
- Planner: Reduce `estimatedSubQueries`, use sequential execution
- Cache: Add caching for expensive operations

#### Spike in EPARSE Errors
**Investigation:**
1. Compare recent prompt changes
2. Validate `JSON_OUTPUT_REQUIREMENTS` in affected prompts
3. Check model drift or API changes

**Resolution:**
- Roll back prompt changes
- Increase token budgets for planner/classifier/router
- Add stricter JSON validation in prompts

#### Rate Limit Errors
**Investigation:**
1. Check `rateLimitQPS` and `rateLimitBurst` in config
2. Review request rate in recent time window

**Resolution:**
- Lower `rateLimitQPS` and `burst` in config
- Enable aggressive caching
- Reduce `maxResults` in retrieval

---

## Configuration

### Token Tracker Configuration
```typescript
// In application code
import { tokenTracker } from '@/lib/services/token-tracker'

// Set daily limit (tokens)
tokenTracker.setDailyLimit(1000000) // 1M tokens

// Set alert threshold (percentage)
tokenTracker.setAlertThreshold(80) // Alert at 80%

// Model pricing (internal, modify in token-tracker.ts)
modelPricing = {
  'gpt-4': { promptCostPer1k: 0.03, completionCostPer1k: 0.06 },
  'gpt-4-turbo': { promptCostPer1k: 0.01, completionCostPer1k: 0.03 },
  'gpt-3.5-turbo': { promptCostPer1k: 0.0005, completionCostPer1k: 0.0015 }
}
```

### Agent Analytics Configuration
```typescript
// In agent-analytics.ts
thresholds = {
  longRunningMs: 15000,      // 15 seconds
  consecutiveFailures: 1      // Alert on first failure
}
```

### Error Tracker Configuration
```typescript
// In error-tracker.ts
maxErrorRetention = 500  // Keep last 500 errors
```

### Existing Config Keys
**File:** [`src/lib/config.ts`](src/lib/config.ts)

- `telemetry.enableAgentMetrics` - Enable/disable telemetry
- `safety.sanitizeQueries` - Enable query sanitization
- `safety.redactPII` - Enable PII redaction
- `safety.maxUserQueryChars` - Max query length
- `llm.maxRetries` - LLM retry attempts
- `llm.retryBackoffMs` - Retry backoff duration
- `llm.timeoutMs` - Request timeout
- `llm.rateLimitQPS` - Rate limit (queries per second)
- `llm.rateLimitBurst` - Rate limit burst size
- `llm.enableStreaming` - Enable streaming responses

### Proposed Environment Variables
```bash
# Token budget (optional, overrides default)
VITE_TOKEN_DAILY_LIMIT=1000000

# Cost per 1K tokens (optional, for display)
VITE_COST_PER_1K_TOKENS_PROMPT=0.01
VITE_COST_PER_1K_TOKENS_COMPLETION=0.03

# Telemetry sampling rate (0.0 to 1.0)
VITE_TELEMETRY_SAMPLING_RATE=1.0  # dev
VITE_TELEMETRY_SAMPLING_RATE=0.2  # staging
VITE_TELEMETRY_SAMPLING_RATE=0.0  # prod (privacy)

# Redaction (default true)
VITE_TELEMETRY_REDACT=true
```

---

## Privacy and Security

### PII Redaction Policy
**Default:** Never emit raw user queries or full model outputs

**Redaction Rules:**
- Query: Sanitized 100-char prefix + hash for correlation
- Response: Sanitized 100-char prefix + hash
- Sources: Only counts and score aggregates (no full text)

**Sanitization Function:**
[`sanitizeQueryForPrompt()`](src/lib/prompt-utils.ts:10) in prompt-utils.ts

**Applied:**
- Neutralizes code fences (``` → ''')
- Removes jailbreak patterns ("Ignore previous instructions")
- Redacts emails, API keys, phone numbers (when `redactPII` enabled)
- Enforces max length (`maxUserQueryChars`)

### Data Retention

**In-Memory:**
- Token metrics: Last 1000 requests
- Error events: Last 500 errors
- Alert panel: All alerts until dismissed

**Persistent Storage (localStorage):**
- Daily token budget: Current day only (auto-resets)

**Persistent Storage (Spark KV):**
- System alerts: Until acknowledged + 1 hour OR manually dismissed
- Cache metadata: Per TTL configuration
- Document metadata: Until document deleted

**Recommended Retention:**
- Production logs: 7 days
- Staging logs: 30 days
- Dev logs: No retention limit

---

## Testing Considerations

### Unit Tests Needed

**Token Tracker:**
- [ ] Token estimation accuracy
- [ ] Cost calculation per model
- [ ] Budget threshold detection
- [ ] Daily usage reset at midnight
- [ ] Metrics by model aggregation

**Error Tracker:**
- [ ] Error type classification
- [ ] Error rate calculation
- [ ] Trend detection (increasing/decreasing/stable)
- [ ] Retention limit enforcement (500 max)
- [ ] Error filtering by type/agent/time window

**Alert Panel:**
- [ ] Alert acknowledgment
- [ ] Alert dismissal
- [ ] Auto-cleanup after 1 hour
- [ ] Unacknowledged counter accuracy
- [ ] SparkKV persistence

### Integration Tests Needed

**LLM Service:**
- [ ] Token tracking on generateText
- [ ] Token tracking on generateJson
- [ ] Correct provider attribution (azure vs spark)

**Orchestrator:**
- [ ] Error tracking on step failure
- [ ] Error tracking on retrieval fallback
- [ ] Correct agent context in errors

**Agent Analytics:**
- [ ] Toast notification on long-running steps
- [ ] Toast notification on step failures
- [ ] Alert panel integration

### Manual Testing Checklist

- [ ] Costs tab displays correctly after LLM requests
- [ ] Budget warning appears when threshold exceeded
- [ ] Errors tab shows errors after failure
- [ ] Error type classification is accurate
- [ ] AlertPanel shows toast-triggered alerts
- [ ] Alert acknowledgment persists across page refresh
- [ ] Auto-cleanup removes old acknowledged alerts
- [ ] Real-time metrics update every 5 seconds

---

## Known Limitations

### Token Tracker
- **Estimation only:** Uses character-to-token ratio (4:1), not actual tokenizer
- **No streaming support:** Cannot track tokens during streaming responses
- **Model detection:** Relies on model name string matching, may misclassify custom models
- **Cost accuracy:** Pricing is hardcoded and may become outdated
- **Storage fallback:** Falls back to in-memory if Spark KV unavailable (no cross-session persistence)

### Error Tracker
- **Classification heuristics:** Based on error message keywords, may misclassify edge cases
- **Memory only:** No persistent storage, lost on page refresh
- **Retention limit:** Only keeps last 500 errors
- **No stack traces displayed:** Stack traces stored but not shown in UI

### Alert Panel
- **SparkKV dependency:** Requires Spark environment, falls back to localStorage
- **No cross-device sync:** Alerts only visible on device where triggered
- **Manual cleanup:** Relies on user acknowledgment for most alerts
- **No prioritization:** All alerts treated equally regardless of severity

### General
- **No historical analysis:** All metrics are in-memory and lost on refresh
- **No percentile calculations:** P50/P95/P99 latencies not implemented
- **No distributed tracing:** Run IDs exist but no span-level tracing
- **Dev mode only telemetry:** Console logging enabled only in development

---

## Future Enhancements

### Phase 1 (Complete ✅)
- ✅ Token and cost tracking with budget management
- ✅ Error tracking with classification and aggregation
- ✅ Real-time alerting via toast notifications
- ✅ Persistent alert management with AlertPanel
- ✅ Costs and Errors tabs in ScalingDashboard

### Phase 2 (Recommended)
- [ ] Historical metrics persistence to Spark KV
- [ ] P50/P95/P99 latency percentile calculations
- [ ] Query performance trends (complexity-based analysis)
- [ ] Waterfall visualization for agent workflow
- [ ] Custom metrics API for programmatic access
- [ ] Export metrics to CSV/JSON

### Phase 3 (Advanced)
- [ ] Distributed tracing with span relationships
- [ ] ML-based anomaly detection
- [ ] Predictive budget alerts
- [ ] Cost optimization recommendations
- [ ] Integration with external monitoring (Datadog, New Relic)
- [ ] Real tokenizer integration (tiktoken)

---

## Deployment Checklist

### Pre-Deployment
- [ ] Review and adjust token budget limits
- [ ] Verify model pricing is up-to-date
- [ ] Configure alert thresholds for environment
- [ ] Set appropriate telemetry sampling rate
- [ ] Enable PII redaction in production
- [ ] Review and update runbook procedures

### Post-Deployment
- [ ] Verify token tracking is reporting correctly
- [ ] Confirm error tracking is capturing failures
- [ ] Test toast notification delivery
- [ ] Verify AlertPanel persistence
- [ ] Check ScalingDashboard auto-refresh
- [ ] Monitor initial budget consumption
- [ ] Review error rates and types

### Operational Monitoring
- **Daily:** Review Costs tab for budget consumption
- **Daily:** Check Errors tab for error rate trends
- **Weekly:** Analyze AlertPanel for recurring issues
- **Weekly:** Review error types and agents for patterns
- **Monthly:** Update model pricing if needed
- **Monthly:** Adjust budget limits based on usage

---

## Summary

The observability layer is now **production-ready** with comprehensive monitoring capabilities:

✅ **Cost Management:** Track LLM token usage and costs with daily budgets
✅ **Error Tracking:** Systematic error classification and rate monitoring
✅ **Real-time Alerts:** Toast notifications for immediate visibility
✅ **Persistent Alerts:** AlertPanel for historical alert management
✅ **Rich UI:** Costs and Errors tabs with auto-refreshing metrics
✅ **Type-Safe:** Full TypeScript support with proper interfaces
✅ **Privacy-First:** PII redaction and query sanitization built-in

**Status:** All Sprint 1 priorities complete. System provides actionable insights for debugging, cost optimization, and operational monitoring.

**Next Steps:** Consider Phase 2 enhancements for historical analysis and advanced visualizations.
