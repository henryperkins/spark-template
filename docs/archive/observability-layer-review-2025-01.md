# Observability Layer Review

**Date:** 2025-11-01
**Reviewed Components:** AgentWorkflowVisualizer, ScalingDashboard, Telemetry, Analytics, Cache Metrics, Performance Timing, Quality Metrics

---

## Executive Summary

The Observability Layer provides **solid real-time monitoring** with excellent workflow visualization and quality metrics tracking. However, it lacks **historical analysis**, **cost tracking**, and **systematic error aggregation** needed for production-grade observability.

**Overall Score: 7.5/10**

---

## ✅ What's Implemented & Working Well

### 1. AgentWorkflowVisualizer
**Location:** `src/components/AgentWorkflowVisualizer.tsx:1`

**Strengths:**
- **Real-time visualization** with live updates during query processing
- **Rich status tracking**: pending → running → completed/failed
- **Per-step timing** with millisecond/second formatting
- **Agent-specific styling**: Color-coded icons for each agent
  - Classifier (blue) - `Brain` icon
  - Planner (purple) - `TreeStructure` icon
  - Router (green) - `GitBranch` icon
  - Retrieval (yellow) - `MagnifyingGlass` icon
  - Generator (pink) - `Sparkle` icon
  - Critic (red) - `ShieldCheck` icon
  - ReAct (indigo) - `ArrowsClockwise` icon
- **Expandable details**: Shows validation scores, sub-queries, ReAct iterations, retrieved sources
- **Animation support**: Smooth transitions using Framer Motion
- **Type-safe result parsing** with proper type guards

**Implementation Quality:** ⭐⭐⭐⭐⭐ (9/10)

**Code Reference:**
```typescript
// AgentWorkflowStep interface (orchestrator.ts:13-20)
export interface AgentWorkflowStep {
  agent: string
  action: string
  result: unknown
  timestamp: string
  duration?: number
  status: 'pending' | 'running' | 'completed' | 'failed'
}
```

---

### 2. ScalingDashboard
**Location:** `src/components/ScalingDashboard.tsx:1`

**Strengths:**
- **Three-tab organization**: Embeddings, Cache, Metrics
- **Embedding refresh tracking**:
  - Incremental vs. full refresh with progress bars
  - Real-time progress callbacks showing current document
  - Volatility-based refresh metrics
- **Cache metrics**:
  - Hit rate calculation
  - Stale entries count
  - TTL distribution
  - Invalidation history (last 10 events)
- **Volatility-based refresh intervals**:
  - High: 1 day
  - Medium: 7 days
  - Low: 30 days
- **System overview**: Documents, chunks, versions

**Implementation Quality:** ⭐⭐⭐⭐ (8/10)

**Key Metrics Displayed:**
```
Embeddings Tab:
- Total documents
- Documents needing refresh
- Average age since last refresh
- Version distribution
- Last refresh results (refreshed/skipped/duration)

Cache Tab:
- Total cached keys
- Hit rate percentage
- Stale entries count
- Average cache entry age
- TTL distribution (short/medium/long/very long)
- Recent invalidations with type and reason

Metrics Tab:
- Total documents and chunks
- Embedding version
- Cache version
- Volatility distribution (high/medium/low)
```

---

### 3. Workflow Step Tracking
**Location:** `src/lib/agents/orchestrator.ts:13-33`

**Strengths:**
- **Structured step interface**: agent, action, result, timestamp, duration, status
- **Callback architecture**:
  - `onWorkflowUpdate?: (workflow: AgentWorkflowStep[]) => void`
  - `onStepEvent?: (event: AgentStepEvent) => void`
- **Error handling**: Captures failures with reasons and marks steps as failed
- **Run IDs**: Unique identifiers for correlation using `crypto.randomUUID()`
- **Integration with telemetry**: Sends events to both telemetry service and analytics backend

**Implementation Quality:** ⭐⭐⭐⭐⭐ (9/10)

**Code Reference:**
```typescript
// ProcessQueryOptions interface (orchestrator.ts:35-39)
export interface ProcessQueryOptions {
  runId?: string
  onWorkflowUpdate?: (workflow: AgentWorkflowStep[]) => void
  onStepEvent?: (event: AgentStepEvent) => void
}
```

**Event Flow:**
```
executeStep() → running event
    ↓
  fn() executes
    ↓
completed/failed event → telemetry.trackAgentStep()
    ↓                 → agentAnalytics.recordStepEvent()
    ↓                 → options.onStepEvent()
onWorkflowUpdate() → UI updates
```

---

### 4. Performance Timing

**Sources:**
- **Orchestrator**: Total duration + per-step duration (`orchestrator.ts:176-189`)
- **Cache Manager**: Average cache entry age (`cache-manager.ts:252-289`)
- **Embedding Manager**: Refresh operation duration

**Metrics Tracked:**
- Per-step duration (ms)
- Total query duration (ms)
- Cache entry age (seconds)
- Embedding refresh duration (ms)

**Implementation Quality:** ⭐⭐⭐⭐ (8/10)

**Example:**
```typescript
// orchestrator.ts:202-263
private async executeStep<T>(
  workflow: AgentWorkflowStep[],
  agent: string,
  action: string,
  fn: () => Promise<T>,
  emitWorkflowUpdate?: () => void,
  emitStepEvent?: (event: ...) => void
): Promise<T> {
  const stepStart = Date.now()
  // ... execution ...
  const duration = Date.now() - stepStart

  workflow[stepIndex] = {
    ...runningStep,
    duration,
    status: 'completed'
  }
}
```

---

### 5. Cache Hit Rate Monitoring
**Location:** `src/lib/cache-manager.ts:32-93`

**Strengths:**
- **Hit/miss counters** with ratio calculation
- **TTL categorization**:
  - Short: < 10 minutes
  - Medium: < 1 hour
  - Long: < 1 day
  - Very long: ≥ 1 day
- **Stale entry detection** and cleanup
- **Invalidation event history**: Last 100 events with type, reason, timestamp
- **resetMetrics()** for clearing counters

**Implementation Quality:** ⭐⭐⭐⭐ (8/10)

**Metrics Interface:**
```typescript
// cache-manager.ts:18-26
export interface CacheMetrics {
  totalKeys: number
  hitRate: number
  missRate: number
  averageAge: number
  staleEntries: number
  byTTL: Record<string, number>
  recentInvalidations: CacheInvalidationEvent[]
}
```

**Hit Rate Calculation:**
```typescript
// cache-manager.ts:276-278
const total = this.hits + this.misses
const hitRate = total > 0 ? this.hits / total : 0
const missRate = total > 0 ? this.misses / total : 0
```

---

### 6. Quality Metrics (Faithfulness & Relevance)
**Location:** `src/lib/agents/critic-agent.ts:7-14`

**Strengths:**
- **Faithfulness score (0-1)**: Measures grounding in source documents
- **Relevance score (0-1)**: Measures alignment with query
- **Validation issues**: Specific problems identified (array of strings)
- **Actionable suggestions**: Concrete improvement recommendations
- **Fallback validation**: Heuristic-based when LLM fails

**Implementation Quality:** ⭐⭐⭐⭐⭐ (9/10)

**Validation Result Interface:**
```typescript
// critic-agent.ts:7-14
export interface ValidationResult {
  isValid: boolean
  confidence: number
  issues: string[]
  suggestions: string[]
  faithfulnessScore: number  // 0-1
  relevanceScore: number     // 0-1
}
```

**Evaluation Criteria (from prompt):**
1. **FAITHFULNESS**: Is the response supported by sources? No hallucinations?
2. **RELEVANCE**: Does the response actually answer the question?
3. **ACCURACY**: Are facts correctly stated?
4. **CITATIONS**: Are sources properly referenced?

**Display in UI:**
```typescript
// QueryInterface.tsx:207-237
{message.agenticResult.validation && (
  <div className="mt-3 p-3 bg-muted rounded-lg">
    <div className="text-xs font-medium mb-2">Quality Metrics</div>
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div>Faithfulness: {(faithfulnessScore * 100).toFixed(0)}%</div>
      <div>Relevance: {(relevanceScore * 100).toFixed(0)}%</div>
      <div>Total Time: {(totalDuration / 1000).toFixed(2)}s</div>
      <div>Complexity: {classification.complexity}</div>
    </div>
  </div>
)}
```

---

### 7. Telemetry Service
**Location:** `src/lib/services/telemetry.ts:59-99`

**Strengths:**
- **Multi-sink support**: Spark telemetry/analytics/analyticsClient
- **Dev logging fallback**: Console output in non-production environments
- **Type-safe events**: AgentStepEvent, AgentAlertEvent
- **Graceful degradation**: Continues on telemetry failures

**Implementation Quality:** ⭐⭐⭐⭐ (8/10)

**Event Types:**
```typescript
// telemetry.ts:3-14
export interface AgentStepEvent {
  type: 'agent_step_status'
  runId: string
  query: string
  agent: string
  action: string
  status: AgentStepStatus
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}

// telemetry.ts:18-30
export interface AgentAlertEvent {
  type: 'agent_step_alert'
  runId: string
  query: string
  agent: string
  action: string
  severity: 'warning' | 'error'
  code: AgentAlertCode
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}
```

**Sink Resolution Logic:**
```typescript
// telemetry.ts:60-90
private track(eventName: string, payload: unknown): void {
  const spark = (window as unknown as { spark?: SparkLike }).spark
  const telemetry = spark?.telemetry || spark?.analytics || spark?.analyticsClient

  if (telemetry) {
    if ('track' in telemetry) telemetry.track(eventName, payload)
    else if ('capture' in telemetry) telemetry.capture(eventName, payload)
  }

  // Fallback to console in dev
  if (isDevEnvironment()) {
    console.debug(`[telemetry:${eventName}]`, payload)
  }
}
```

---

### 8. Agent Analytics
**Location:** `src/lib/services/agent-analytics.ts:11-92`

**Strengths:**
- **Alert threshold configuration**:
  - 15 seconds for long-running steps
  - 1 consecutive failure triggers alert
- **Failure tracking**: Per agent-action combination
- **Automatic reset**: Clears failure count on success
- **Severity levels**: warning vs. error
- **Alert codes**: `long_running_step`, `step_failure`
- **Integration**: Sends to both analytics backend and telemetry

**Implementation Quality:** ⭐⭐⭐⭐ (8/10)

**Alert Thresholds:**
```typescript
// agent-analytics.ts:4-7, 12-15
interface AlertThresholds {
  longRunningMs: number
  consecutiveFailures: number
}

private readonly thresholds: AlertThresholds = {
  longRunningMs: 15000,      // 15 seconds
  consecutiveFailures: 1
}
```

**Alert Handling:**
```typescript
// agent-analytics.ts:38-44
private handleCompletion(event: AgentStepEvent): void {
  this.resetFailureCounter(event)

  if (event.duration && event.duration > this.thresholds.longRunningMs) {
    this.raiseAlert(event, 'long_running_step', 'warning')
  }
}

// agent-analytics.ts:46-55
private handleFailure(event: AgentStepEvent): void {
  const key = this.failureKey(event)
  const current = this.failureCounts.get(key) ?? 0
  const next = current + 1
  this.failureCounts.set(key, next)

  if (next >= this.thresholds.consecutiveFailures) {
    this.raiseAlert(event, 'step_failure', 'error')
  }
}
```

---

## ⚠️ Critical Gaps & Missing Components

### 1. Token/Cost Tracking ⚠️ HIGH PRIORITY

**Missing:**
- No tracking of LLM token usage (prompt tokens, completion tokens, total)
- No cost calculation per query or aggregated
- No budget alerts or rate limiting
- No model-specific cost differentiation

**Impact:** HIGH - Can't optimize costs or detect runaway spending

**Location to add:** `src/lib/services/llm-service.ts`

**Recommended Implementation:**
```typescript
interface LLMUsageMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number  // Based on model pricing
  modelUsed: string
  timestamp: string
}

interface TokenBudget {
  dailyLimit: number
  currentUsage: number
  alertThreshold: number  // Percentage (e.g., 80)
}

class LLMService {
  private usageMetrics: LLMUsageMetrics[] = []

  async generateJson<T>(prompt, schema, options) {
    const result = await /* ... */

    // Track usage
    this.recordUsage({
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      estimatedCost: this.calculateCost(result.usage, modelName),
      modelUsed: modelName,
      timestamp: new Date().toISOString()
    })

    return result
  }

  getDailyUsage(): { tokens: number; cost: number } {
    const today = new Date().toISOString().split('T')[0]
    const todayMetrics = this.usageMetrics.filter(m =>
      m.timestamp.startsWith(today)
    )

    return {
      tokens: todayMetrics.reduce((sum, m) => sum + m.totalTokens, 0),
      cost: todayMetrics.reduce((sum, m) => sum + m.estimatedCost, 0)
    }
  }
}
```

**UI Addition to ScalingDashboard:**
```typescript
<TabsTrigger value="costs">
  <CurrencyDollar size={16} className="mr-2" />
  Costs
</TabsTrigger>

<TabsContent value="costs">
  <Card>
    <CardHeader>
      <CardTitle>Token Usage & Costs</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Today's Tokens</div>
          <div className="text-2xl font-bold">{dailyTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Today's Cost</div>
          <div className="text-2xl font-bold">${dailyCost.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Avg Cost/Query</div>
          <div className="text-2xl font-bold">${avgCostPerQuery.toFixed(3)}</div>
        </div>
      </div>
    </CardContent>
  </Card>
</TabsContent>
```

---

### 2. Query Performance Aggregation ⚠️ MEDIUM PRIORITY

**Missing:**
- No P50/P95/P99 latency percentiles
- No average query time trends
- No breakdown by query complexity (simple vs. complex)
- No comparison of agentic vs. non-agentic mode performance

**Impact:** MEDIUM - Can't identify performance regressions or optimize slow queries

**Location to add:** New file `src/lib/services/query-metrics.ts`

**Recommended Implementation:**
```typescript
interface QueryMetric {
  queryId: string
  query: string
  duration: number
  complexity: 'simple' | 'medium' | 'complex'
  agenticMode: boolean
  azureUsed: boolean
  stepCount: number
  timestamp: string
}

class QueryMetricsService {
  private metrics: QueryMetric[] = []

  record(metric: QueryMetric): void {
    this.metrics.push(metric)

    // Keep last 1000 queries in memory
    if (this.metrics.length > 1000) {
      this.metrics.shift()
    }

    // Persist to Spark KV for historical analysis
    this.persistToKV(metric)
  }

  getPercentiles(): { p50: number; p95: number; p99: number } {
    const sorted = [...this.metrics]
      .map(m => m.duration)
      .sort((a, b) => a - b)

    return {
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99)
    }
  }

  getAverageByComplexity(): Record<string, number> {
    const byComplexity = this.groupBy(this.metrics, m => m.complexity)

    return Object.fromEntries(
      Object.entries(byComplexity).map(([complexity, metrics]) => [
        complexity,
        metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length
      ])
    )
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[index] ?? 0
  }
}

export const queryMetrics = new QueryMetricsService()
```

**Integration in Orchestrator:**
```typescript
// orchestrator.ts:53
async processQuery(...): Promise<AgenticRAGResult> {
  const startTime = Date.now()
  // ... existing code ...
  const totalDuration = Date.now() - startTime

  // Record metrics
  queryMetrics.record({
    queryId: runId,
    query,
    duration: totalDuration,
    complexity: classification.complexity,
    agenticMode: true,
    azureUsed: allSources.some(s => s.azureScore !== undefined),
    stepCount: workflow.length,
    timestamp: new Date().toISOString()
  })

  return { /* ... */ }
}
```

---

### 3. Error Rate Tracking ⚠️ MEDIUM PRIORITY

**Missing:**
- Errors logged to console but not aggregated
- No error rate calculation (errors per hour/day)
- No error type classification (retrieval failures, LLM timeouts, etc.)
- No automatic error pattern detection

**Impact:** MEDIUM - Can't proactively detect system degradation

**Location to add:** Extend `src/lib/services/agent-analytics.ts`

**Recommended Implementation:**
```typescript
interface ErrorEvent {
  errorId: string
  type: 'retrieval' | 'llm' | 'embedding' | 'cache' | 'network' | 'unknown'
  message: string
  stack?: string
  agent?: string
  query?: string
  timestamp: string
}

interface ErrorMetrics {
  totalErrors: number
  errorRate: number  // errors per hour
  byType: Record<string, number>
  recentErrors: ErrorEvent[]
}

class ErrorTrackingService {
  private errors: ErrorEvent[] = []

  record(error: Error, context?: { type?: string; agent?: string; query?: string }): void {
    const errorEvent: ErrorEvent = {
      errorId: crypto.randomUUID(),
      type: context?.type || this.classifyError(error),
      message: error.message,
      stack: error.stack,
      agent: context?.agent,
      query: context?.query,
      timestamp: new Date().toISOString()
    }

    this.errors.push(errorEvent)

    // Keep last 500 errors
    if (this.errors.length > 500) {
      this.errors.shift()
    }

    // Send to analytics
    analyticsBackend.send('error_event', errorEvent)
  }

  getMetrics(): ErrorMetrics {
    const now = Date.now()
    const oneHourAgo = now - 3600000

    const recentErrors = this.errors.filter(e =>
      new Date(e.timestamp).getTime() > oneHourAgo
    )

    return {
      totalErrors: this.errors.length,
      errorRate: recentErrors.length,
      byType: this.countByType(this.errors),
      recentErrors: this.errors.slice(-10)
    }
  }

  private classifyError(error: Error): ErrorEvent['type'] {
    const msg = error.message.toLowerCase()
    if (msg.includes('fetch') || msg.includes('network')) return 'network'
    if (msg.includes('llm') || msg.includes('generate')) return 'llm'
    if (msg.includes('retrieval') || msg.includes('search')) return 'retrieval'
    if (msg.includes('embedding')) return 'embedding'
    if (msg.includes('cache')) return 'cache'
    return 'unknown'
  }
}

export const errorTracking = new ErrorTrackingService()
```

**Integration Example:**
```typescript
// In orchestrator.ts:241-262
catch (error) {
  const duration = Date.now() - stepStart

  // Track error
  errorTracking.record(error as Error, {
    agent,
    query,
    type: 'retrieval'  // or classify based on agent
  })

  workflow[stepIndex] = {
    ...runningStep,
    action: `${action} (failed)`,
    result: { error: error instanceof Error ? error.message : 'Unknown error' },
    timestamp: new Date().toISOString(),
    duration,
    status: 'failed'
  }

  throw error
}
```

**UI Addition to ScalingDashboard:**
```typescript
<TabsTrigger value="errors">
  <WarningCircle size={16} className="mr-2" />
  Errors
</TabsTrigger>

<TabsContent value="errors">
  <Card>
    <CardHeader>
      <CardTitle>Error Tracking</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-sm text-muted-foreground">Error Rate (last hour)</div>
          <div className="text-2xl font-bold text-red-600">{errorRate}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Total Errors</div>
          <div className="text-2xl font-bold">{totalErrors}</div>
        </div>
      </div>

      <Separator className="my-4" />

      <h4 className="font-medium text-sm mb-2">Error Types</h4>
      <div className="space-y-1">
        {Object.entries(byType).map(([type, count]) => (
          <div key={type} className="flex justify-between text-sm">
            <span className="capitalize">{type}</span>
            <Badge variant="destructive">{count}</Badge>
          </div>
        ))}
      </div>

      <Separator className="my-4" />

      <h4 className="font-medium text-sm mb-2">Recent Errors</h4>
      <div className="space-y-2">
        {recentErrors.map(error => (
          <div key={error.errorId} className="p-2 bg-destructive/10 rounded text-xs">
            <div className="flex justify-between mb-1">
              <Badge variant="outline">{error.type}</Badge>
              <span className="text-muted-foreground">
                {new Date(error.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-destructive">{error.message}</p>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
</TabsContent>
```

---

### 4. Resource Utilization Monitoring ⚠️ LOW PRIORITY

**Missing:**
- No memory usage tracking
- No local storage consumption monitoring
- No network request counting
- No embedding computation time vs. Azure time split

**Impact:** LOW - Nice to have for optimization but not critical

**Recommended Implementation:**
```typescript
interface ResourceMetrics {
  memoryUsageMB: number
  localStorageSizeMB: number
  networkRequestCount: number
  embeddingTimeLocal: number
  embeddingTimeAzure: number
}

class ResourceMonitor {
  getMemoryUsage(): number {
    if ('memory' in performance) {
      const mem = (performance as any).memory
      return mem.usedJSHeapSize / (1024 * 1024)
    }
    return 0
  }

  getLocalStorageSize(): number {
    let total = 0
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length
      }
    }
    return total / (1024 * 1024)
  }

  getMetrics(): ResourceMetrics {
    return {
      memoryUsageMB: this.getMemoryUsage(),
      localStorageSizeMB: this.getLocalStorageSize(),
      // ... other metrics
    }
  }
}
```

---

### 5. Retention & Historical Trends ⚠️ MEDIUM PRIORITY

**Issues:**
- Cache invalidation history: limited to last 100 (`cache-manager.ts:114-117`)
- No long-term metric storage
- No daily/weekly/monthly aggregations
- Metrics reset on page refresh (in-memory only)

**Impact:** MEDIUM - Can't analyze trends or detect slow degradation

**Solution:** Store metrics in Spark KV with time-based keys

**Recommended Implementation:**
```typescript
interface DailyMetricsSnapshot {
  date: string  // YYYY-MM-DD
  queriesProcessed: number
  averageLatency: number
  p95Latency: number
  cacheHitRate: number
  errorRate: number
  totalCost: number
  totalTokens: number
}

class MetricsRetention {
  async saveDailySnapshot(snapshot: DailyMetricsSnapshot): Promise<void> {
    const key = `metrics:daily:${snapshot.date}`
    await window.spark.kv.set(key, snapshot)
  }

  async getHistoricalMetrics(days: number): Promise<DailyMetricsSnapshot[]> {
    const snapshots: DailyMetricsSnapshot[] = []
    const today = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const key = `metrics:daily:${dateStr}`
      const snapshot = await window.spark.kv.get(key)
      if (snapshot) {
        snapshots.push(snapshot as DailyMetricsSnapshot)
      }
    }

    return snapshots
  }
}
```

**Schedule Daily Snapshots:**
```typescript
// Run at end of day or on visibility change
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    const today = new Date().toISOString().split('T')[0]
    const snapshot = await metricsRetention.createSnapshot(today)
    await metricsRetention.saveDailySnapshot(snapshot)
  }
})
```

---

### 6. User Session Analytics ⚠️ LOW PRIORITY

**Missing:**
- No session duration tracking
- No queries per session
- No user journey tracking (upload → query flow)
- No abandonment rate measurement

**Impact:** LOW - More product analytics than observability

**Recommended Implementation:**
```typescript
interface SessionMetrics {
  sessionId: string
  startTime: string
  endTime?: string
  queriesCount: number
  documentsUploaded: number
  integrationsUsed: string[]
  featuresUsed: string[]
}

class SessionTracker {
  private session: SessionMetrics

  constructor() {
    this.session = {
      sessionId: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      queriesCount: 0,
      documentsUploaded: 0,
      integrationsUsed: [],
      featuresUsed: []
    }

    // Track session end
    window.addEventListener('beforeunload', () => {
      this.endSession()
    })
  }

  trackQuery(): void {
    this.session.queriesCount++
    this.trackFeature('query')
  }

  trackUpload(): void {
    this.session.documentsUploaded++
    this.trackFeature('upload')
  }

  private trackFeature(feature: string): void {
    if (!this.session.featuresUsed.includes(feature)) {
      this.session.featuresUsed.push(feature)
    }
  }

  endSession(): void {
    this.session.endTime = new Date().toISOString()
    analyticsBackend.send('session_end', this.session)
  }
}
```

---

### 7. Alerting Destinations ⚠️ MEDIUM PRIORITY

**Issues:**
- Alerts generated (`agent-analytics.ts:68-91`) but no clear handling
- No alert UI notifications
- No alert persistence
- No alert acknowledgment workflow

**Impact:** MEDIUM - Alerts are created but potentially invisible to users

**Solution:** Add toast notifications or alert panel in UI

**Recommended Implementation:**

**Option A: Toast Notifications (Immediate)**
```typescript
// In agent-analytics.ts:68-91
private raiseAlert(...): void {
  const alertPayload = { /* ... */ }

  void analyticsBackend.send('agent_step_alert', alertPayload)
  telemetry.trackAgentAlert(alertPayload)

  // Show toast notification
  if (alertPayload.severity === 'error') {
    toast.error(`Agent Error: ${alertPayload.agent}`, {
      description: alertPayload.failureReason || `${alertPayload.action} failed`
    })
  } else {
    toast.warning(`Slow Step: ${alertPayload.agent}`, {
      description: `${alertPayload.action} took ${(alertPayload.duration! / 1000).toFixed(2)}s`
    })
  }
}
```

**Option B: Alert Panel (Persistent)**
```typescript
// New component: src/components/AlertPanel.tsx
interface Alert {
  id: string
  severity: 'warning' | 'error'
  code: string
  message: string
  timestamp: string
  acknowledged: boolean
}

export function AlertPanel() {
  const [alerts, setAlerts] = useSparkKV<Alert[]>('system-alerts', [])

  const acknowledgeAlert = (id: string) => {
    setAlerts(alerts.map(a =>
      a.id === id ? { ...a, acknowledged: true } : a
    ))
  }

  const unacknowledged = alerts.filter(a => !a.acknowledged)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell size={20} />
          System Alerts
          {unacknowledged.length > 0 && (
            <Badge variant="destructive">{unacknowledged.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(alert => (
              <Alert key={alert.id} variant={alert.severity === 'error' ? 'destructive' : 'default'}>
                <AlertTitle>{alert.code}</AlertTitle>
                <AlertDescription>{alert.message}</AlertDescription>
                {!alert.acknowledged && (
                  <Button size="sm" onClick={() => acknowledgeAlert(alert.id)}>
                    Acknowledge
                  </Button>
                )}
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

---

### 8. Distributed Tracing ⚠️ LOW PRIORITY

**Missing:**
- Run IDs exist but not propagated everywhere
- No trace spans for sub-operations
- No parent-child relationship tracking
- No trace visualization beyond single query

**Impact:** LOW - Current run IDs are sufficient for single-query debugging

**Recommended Enhancement:**
```typescript
interface TraceSpan {
  spanId: string
  traceId: string
  parentSpanId?: string
  name: string
  startTime: string
  endTime?: string
  duration?: number
  attributes: Record<string, unknown>
}

class TracingService {
  private spans: Map<string, TraceSpan> = new Map()

  startSpan(name: string, traceId: string, parentSpanId?: string): string {
    const spanId = crypto.randomUUID()

    this.spans.set(spanId, {
      spanId,
      traceId,
      parentSpanId,
      name,
      startTime: new Date().toISOString(),
      attributes: {}
    })

    return spanId
  }

  endSpan(spanId: string, attributes?: Record<string, unknown>): void {
    const span = this.spans.get(spanId)
    if (!span) return

    const endTime = new Date().toISOString()
    const duration = new Date(endTime).getTime() - new Date(span.startTime).getTime()

    this.spans.set(spanId, {
      ...span,
      endTime,
      duration,
      attributes: { ...span.attributes, ...attributes }
    })
  }

  getTrace(traceId: string): TraceSpan[] {
    return Array.from(this.spans.values())
      .filter(span => span.traceId === traceId)
  }
}
```

---

## 📊 Component Interaction Analysis

Your observability components interact well with a clean architecture:

```
┌─────────────────┐
│ QueryInterface  │ (UI Layer)
│   (User Input)  │
└────────┬────────┘
         │ calls
         ↓
┌─────────────────────┐
│ AgenticOrchestrator │ (Business Logic)
│  processQuery()     │
└──────┬──────────────┘
       │ emits events
       ├──────────────────┬─────────────────┬──────────────────┐
       ↓                  ↓                 ↓                  ↓
┌──────────────┐  ┌───────────────┐  ┌─────────────┐  ┌──────────────┐
│  Telemetry   │  │ AgentAnalytics│  │ onWorkflow  │  │  onStepEvent │
│   Service    │  │               │  │   Update    │  │   callback   │
└──────┬───────┘  └───────┬───────┘  └──────┬──────┘  └──────┬───────┘
       │                  │                  │                │
       │ track()          │ send()           │ setState()     │ (custom)
       ↓                  ↓                  ↓                ↓
┌──────────────┐  ┌───────────────┐  ┌─────────────────────────────┐
│    Spark     │  │   Analytics   │  │  AgentWorkflowVisualizer    │
│  Analytics   │  │    Backend    │  │     (Real-time UI)          │
└──────────────┘  └───────────────┘  └─────────────────────────────┘
                         │
                         │ POST /analytics
                         ↓
                  ┌──────────────┐
                  │   External   │
                  │   Analytics  │
                  │    Server    │
                  └──────────────┘
```

**Strengths:**
- **Clean separation of concerns**: UI, business logic, analytics separate
- **Callback-based real-time updates**: Enables live visualization
- **Multiple sinks for redundancy**: Spark + Analytics Backend + Console
- **Type-safe event contracts**: AgentStepEvent, AgentAlertEvent interfaces
- **Graceful degradation**: Fallback to console in dev mode

**Weaknesses:**
- **No centralized metrics store**: All in-memory, lost on refresh
- **No metrics query API**: Can't retrieve historical data programmatically
- **No time-series analysis**: Can't track trends over time
- **No cross-query correlation**: Hard to analyze patterns across multiple queries

---

## 🎯 Summary Score Card

| Component | Coverage | Quality | Gaps | Score |
|-----------|----------|---------|------|-------|
| **Workflow Tracking** | 95% | ⭐⭐⭐⭐⭐ | Missing waterfall view | 9/10 |
| **Performance Timing** | 80% | ⭐⭐⭐⭐ | No percentiles, no cost tracking | 7/10 |
| **Cache Monitoring** | 90% | ⭐⭐⭐⭐ | Limited retention | 8/10 |
| **Quality Metrics** | 95% | ⭐⭐⭐⭐⭐ | Excellent implementation | 9/10 |
| **Error Tracking** | 40% | ⭐⭐ | Console-only, no aggregation | 4/10 |
| **Alerting** | 60% | ⭐⭐⭐ | Generated but not visible | 6/10 |
| **Analytics Backend** | 70% | ⭐⭐⭐⭐ | No historical storage | 7/10 |
| **Telemetry** | 85% | ⭐⭐⭐⭐ | Works well, good fallbacks | 8/10 |

**Overall Observability Score: 7.5/10**

---

## 🚀 Prioritized Recommendations

### Immediate (Sprint 1)
1. **Add Token & Cost Tracking** - Critical for production usage monitoring
2. **Add Error Rate Dashboard** - Essential for system health visibility
3. **Add Alert UI (Toast Notifications)** - Make existing alerts visible

### Short-term (Sprint 2)
4. **Persist Metrics to Spark KV** - Enable historical analysis
5. **Add Query Performance Percentiles** - Identify outliers and optimize
6. **Add Costs Tab to ScalingDashboard** - Visualize spending

### Medium-term (Sprint 3)
7. **Add Waterfall Visualization** - Enhanced workflow debugging
8. **Add Session Tracking** - Understand user behavior
9. **Add Resource Monitoring** - Track client-side resource usage

### Long-term (Backlog)
10. **Distributed Tracing** - Advanced debugging for complex flows
11. **ML-based Anomaly Detection** - Proactive issue identification
12. **Custom Metrics API** - Programmatic access to all metrics

---

## 📝 Conclusion

Your **Observability Layer is solid for real-time monitoring** with excellent workflow visualization and quality metrics. The AgentWorkflowVisualizer and CriticAgent validation are particularly well-implemented.

However, to reach **production-grade maturity**, you need:
1. **Cost tracking** - Essential for managing LLM spend
2. **Error aggregation** - Beyond console logging
3. **Historical metrics** - Trend analysis and regression detection
4. **Alert visibility** - Make alerts actionable in the UI

The foundation is strong. Adding these missing pieces will elevate your observability from "good" to "excellent".

**Current State:** Real-time debugging tool
**Target State:** Comprehensive production monitoring platform
**Gap:** Historical analysis, cost tracking, systematic error handling

---

**Files Analyzed:**
- `src/components/AgentWorkflowVisualizer.tsx`
- `src/components/ScalingDashboard.tsx`
- `src/components/QueryInterface.tsx`
- `src/lib/agents/orchestrator.ts`
- `src/lib/agents/critic-agent.ts`
- `src/lib/cache-manager.ts`
- `src/lib/embedding-manager.ts`
- `src/lib/services/telemetry.ts`
- `src/lib/services/agent-analytics.ts`
- `src/lib/services/analytics-backend.ts`
