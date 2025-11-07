I'll show you the complete file replacements for all services using the old system.Now I'll provide complete file replacements for all services using the old system:

---

## ** File 1: `src/lib/services/query-history.ts`(Complete Replacement) **

    ```typescript
/**
 * Query History Service
 * Tracks query execution with routing decisions, performance metrics, and agent workflows
 */

import { storage } from '@/lib/storage'

export interface QueryHistoryEntry {
  id: string
  timestamp: string
  query: string

  // Routing decision
  routing: {
    strategy: 'vector' | 'keyword' | 'hybrid'
    reasoning: string
    confidence: number
  }

  // Results
  resultCount: number
  topScore: number
  azureUsed: boolean
  azureFallback: boolean

  // Performance
  totalDuration: number
  retrievalDuration?: number

  // Agent workflow (if agentic mode)
  workflow?: Array<{
    agent: string
    action: string
    duration: number
    status: string
  }>

  // Classification (if using QueryClassifierAgent)
  complexity?: 'simple' | 'moderate' | 'complex'
  requiresDecomposition?: boolean

  // Validation (if using CriticAgent)
  validation?: {
    faithfulnessScore: number
    relevanceScore: number
    isValid: boolean
  }
}

const KV_KEY = 'query-history'
const MAX_ENTRIES = 100

class QueryHistoryService {
  private cache: QueryHistoryEntry[] | null = null

  /**
   * Add a new query to history
   */
  async add(entry: QueryHistoryEntry): Promise<void> {
    try {
      const history = await this.getAll()

      // Add to beginning (newest first)
      history.unshift(entry)

      // Keep only last MAX_ENTRIES
      if (history.length > MAX_ENTRIES) {
        history.splice(MAX_ENTRIES)
      }

      // Save to storage
      await storage.set(KV_KEY, history)

      // Update cache
      this.cache = history
    } catch (error) {
      console.error('Failed to add query to history:', error)
    }
  }

  /**
   * Get all query history (newest first)
   */
  async getAll(): Promise<QueryHistoryEntry[]> {
    try {
      // Return cached if available
      if (this.cache) {
        return this.cache
      }

      // Load from storage
      const history = await storage.get<QueryHistoryEntry[]>(KV_KEY)
      this.cache = history || []
      return this.cache
    } catch (error) {
      console.error('Failed to load query history:', error)
      return []
    }
  }

  /**
   * Get recent queries (default 20)
   */
  async getRecent(limit: number = 20): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    return all.slice(0, limit)
  }

  /**
   * Search history by query text
   */
  async search(term: string): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    const lowerTerm = term.toLowerCase()
    return all.filter(entry =>
      entry.query.toLowerCase().includes(lowerTerm)
    )
  }

  /**
   * Filter by strategy
   */
  async getByStrategy(strategy: 'vector' | 'keyword' | 'hybrid'): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    return all.filter(entry => entry.routing.strategy === strategy)
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    total: number
    avgDuration: number
    azureFallbackRate: number
    strategyDistribution: Record<string, number>
  }> {
    const all = await this.getAll()

    if (all.length === 0) {
      return {
        total: 0,
        avgDuration: 0,
        azureFallbackRate: 0,
        strategyDistribution: { vector: 0, keyword: 0, hybrid: 0 }
      }
    }

    const totalDuration = all.reduce((sum, e) => sum + e.totalDuration, 0)
    const fallbackCount = all.filter(e => e.azureFallback).length

    const strategyDistribution = all.reduce((acc, entry) => {
      acc[entry.routing.strategy] = (acc[entry.routing.strategy] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total: all.length,
      avgDuration: totalDuration / all.length,
      azureFallbackRate: fallbackCount / all.length,
      strategyDistribution
    }
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    try {
      await storage.delete(KV_KEY)
      this.cache = []
    } catch (error) {
      console.error('Failed to clear query history:', error)
    }
  }

  /**
   * Invalidate cache (force reload from storage)
   */
  invalidateCache(): void {
    this.cache = null
  }
}

export const queryHistoryService = new QueryHistoryService()
```

---

## ** File 2: `src/lib/services/token-tracker.ts`(Complete Replacement) **

    ```typescript
/**
 * Token and Cost Tracking Service
 * Monitors LLM token usage and estimates costs per model
 */

import { storage } from '@/lib/storage'

export interface ModelStats {
  count: number
  totalTokens: number
  totalCost: number
}

export interface LLMUsageMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  modelUsed: string
  timestamp: string
  provider: 'azure' | 'openai'
}

interface ModelPricing {
  promptCostPer1k: number
  completionCostPer1k: number
}

interface TokenBudget {
  dailyLimit: number
  currentUsage: number
  alertThreshold: number // Percentage (e.g., 80)
}

interface DailyUsageSummary {
  date: string
  totalTokens: number
  totalCost: number
  queryCount: number
  avgTokensPerQuery: number
  avgCostPerQuery: number
}

class TokenTracker {
  private usageMetrics: LLMUsageMetrics[] = []
  private maxMetricsRetention = 1000 // Keep last 1000 requests in memory

  // Model pricing (approximate, should be configurable)
  private readonly modelPricing: Record<string, ModelPricing> = {
    'gpt-4': {
      promptCostPer1k: 0.03,
      completionCostPer1k: 0.06
    },
    'gpt-4-turbo': {
      promptCostPer1k: 0.01,
      completionCostPer1k: 0.03
    },
    'gpt-3.5-turbo': {
      promptCostPer1k: 0.0005,
      completionCostPer1k: 0.0015
    },
    'default': {
      promptCostPer1k: 0.01,
      completionCostPer1k: 0.03
    }
  }

  private budget: TokenBudget = {
    dailyLimit: 1000000, // 1M tokens default
    currentUsage: 0,
    alertThreshold: 80
  }

  /**
   * Record token usage from an LLM request
   */
  recordUsage(metrics: Omit<LLMUsageMetrics, 'estimatedCost'>): void {
    const pricing = this.getPricingForModel(metrics.modelUsed)
    const estimatedCost = this.calculateCost(
      metrics.promptTokens,
      metrics.completionTokens,
      pricing
    )

    const fullMetrics: LLMUsageMetrics = {
      ...metrics,
      estimatedCost,
      timestamp: new Date().toISOString()
    }

    this.usageMetrics.push(fullMetrics)

    // Maintain retention limit
    if (this.usageMetrics.length > this.maxMetricsRetention) {
      this.usageMetrics.shift()
    }

    // Update daily usage for budget tracking (async but don't block)
    void this.updateDailyUsage(fullMetrics.totalTokens)
  }

  /**
   * Get pricing for a specific model
   */
  private getPricingForModel(model: string): ModelPricing {
    // Normalize model name
    const normalizedModel = model.toLowerCase()

    if (normalizedModel.includes('gpt-4-turbo')) {
      return this.modelPricing['gpt-4-turbo']
    } else if (normalizedModel.includes('gpt-4')) {
      return this.modelPricing['gpt-4']
    } else if (normalizedModel.includes('gpt-3.5')) {
      return this.modelPricing['gpt-3.5-turbo']
    }

    return this.modelPricing['default']
  }

  /**
   * Calculate cost based on token counts and pricing
   */
  private calculateCost(
    promptTokens: number,
    completionTokens: number,
    pricing: ModelPricing
  ): number {
    const promptCost = (promptTokens / 1000) * pricing.promptCostPer1k
    const completionCost = (completionTokens / 1000) * pricing.completionCostPer1k
    return promptCost + completionCost
  }

  /**
   * Update daily usage counter
   */
  private async updateDailyUsage(tokens: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0]

    try {
      const lastUpdate = await storage.get<string>('token-budget-date')

      if (lastUpdate !== today) {
        // New day, reset usage
        this.budget.currentUsage = tokens
        await storage.set('token-budget-date', today)
        await storage.set('token-budget-usage', tokens)
      } else {
        // Same day, accumulate
        this.budget.currentUsage += tokens
        await storage.set('token-budget-usage', this.budget.currentUsage)
      }
    } catch (error) {
      console.warn('Token budget storage failed, using in-memory tracking only:', error)
    }
  }

  /**
   * Get usage for today
   */
  getDailyUsage(): { tokens: number; cost: number; queryCount: number } {
    const today = new Date().toISOString().split('T')[0]
    const todayMetrics = this.usageMetrics.filter(m =>
      m.timestamp.startsWith(today)
    )

    return {
      tokens: todayMetrics.reduce((sum, m) => sum + m.totalTokens, 0),
      cost: todayMetrics.reduce((sum, m) => sum + m.estimatedCost, 0),
      queryCount: todayMetrics.length
    }
  }

  /**
   * Get usage summary for a date range
   */
  getUsageSummary(days: number = 7): DailyUsageSummary[] {
    const summaries: Map<string, DailyUsageSummary> = new Map()

    this.usageMetrics.forEach(metric => {
      const date = metric.timestamp.split('T')[0]

      if (!summaries.has(date)) {
        summaries.set(date, {
          date,
          totalTokens: 0,
          totalCost: 0,
          queryCount: 0,
          avgTokensPerQuery: 0,
          avgCostPerQuery: 0
        })
      }

      const summary = summaries.get(date)!
      summary.totalTokens += metric.totalTokens
      summary.totalCost += metric.estimatedCost
      summary.queryCount += 1
    })

    // Calculate averages
    summaries.forEach(summary => {
      summary.avgTokensPerQuery = summary.queryCount > 0
        ? summary.totalTokens / summary.queryCount
        : 0
      summary.avgCostPerQuery = summary.queryCount > 0
        ? summary.totalCost / summary.queryCount
        : 0
    })

    // Return most recent days
    return Array.from(summaries.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days)
  }

  /**
   * Get budget status
   */
  async getBudgetStatus(): Promise<{
    dailyLimit: number
    currentUsage: number
    percentageUsed: number
    remainingTokens: number
    isNearLimit: boolean
    isOverLimit: boolean
  }> {
    // Restore from storage if available
    try {
      const savedUsage = await storage.get<number>('token-budget-usage')
      const savedDate = await storage.get<string>('token-budget-date')
      const today = new Date().toISOString().split('T')[0]

      if (savedDate === today && savedUsage !== undefined) {
        this.budget.currentUsage = savedUsage
      } else if (savedDate !== today) {
        this.budget.currentUsage = 0
      }
    } catch (error) {
      console.warn('Failed to restore budget from storage:', error)
    }

    const percentageUsed = (this.budget.currentUsage / this.budget.dailyLimit) * 100
    const remainingTokens = Math.max(0, this.budget.dailyLimit - this.budget.currentUsage)

    return {
      dailyLimit: this.budget.dailyLimit,
      currentUsage: this.budget.currentUsage,
      percentageUsed,
      remainingTokens,
      isNearLimit: percentageUsed >= this.budget.alertThreshold,
      isOverLimit: percentageUsed >= 100
    }
  }

  /**
   * Set daily token budget limit
   */
  setDailyLimit(limit: number): void {
    this.budget.dailyLimit = Math.max(0, limit)
  }

  /**
   * Set alert threshold percentage
   */
  setAlertThreshold(percentage: number): void {
    this.budget.alertThreshold = Math.min(100, Math.max(0, percentage))
  }

  /**
   * Get all usage metrics
   */
  getAllMetrics(): LLMUsageMetrics[] {
    return [...this.usageMetrics]
  }

  /**
   * Get metrics by model
   */
  getMetricsByModel(): Record<string, ModelStats> {
    const byModel: Record<string, ModelStats> = {}

    this.usageMetrics.forEach(metric => {
      if (!byModel[metric.modelUsed]) {
        byModel[metric.modelUsed] = { count: 0, totalTokens: 0, totalCost: 0 }
      }

      byModel[metric.modelUsed].count += 1
      byModel[metric.modelUsed].totalTokens += metric.totalTokens
      byModel[metric.modelUsed].totalCost += metric.estimatedCost
    })

    return byModel
  }

  /**
   * Reset all metrics (for testing or cleanup)
   */
  async resetMetrics(): Promise<void> {
    this.usageMetrics = []
    this.budget.currentUsage = 0

    try {
      await storage.delete('token-budget-usage')
      await storage.delete('token-budget-date')
    } catch (error) {
      console.warn('Failed to clear budget storage:', error)
    }
  }
}

export const tokenTracker = new TokenTracker()
```

---

## ** File 3: `src/lib/azure-search.ts`(Fix Shared Token Issue) **

    Replace the `getBearerToken()` and `proxyHeaders()` methods:

```typescript
// BEFORE (WRONG - uses KV_API_KEY for Azure):
private getBearerToken(): string | undefined {
  const token = window.localStorage?.getItem('KV_API_KEY')  // ❌ Wrong token
  if (token) return token
  if (import.meta.env.VITE_KV_API_KEY) {
    return import.meta.env.VITE_KV_API_KEY  // ❌ Wrong token
  }
  return undefined
}

// AFTER (CORRECT - use dedicated Azure token):
private getBearerToken(): string | undefined {
  try {
    if (typeof window !== 'undefined') {
      const token = window.localStorage?.getItem('AZURE_API_KEY')
      if (token) return token
    }
  } catch {
    // ignore storage errors
  }
  return import.meta.env.VITE_AZURE_API_KEY
}
```

---

## ** File 4: Update `worker/index.ts` Azure Search Handler **

    ```typescript
// BEFORE (uses shared KV_API_KEY):
const expectedBearer = (env as unknown).KV_API_KEY as string | undefined

// AFTER (use dedicated Azure token):
const expectedBearer = env.AZURE_API_KEY as string | undefined
```

And add to `Env` interface:
```typescript
export interface Env {
  RAG_KV: KVNamespace
  LOGS: R2Bucket
  ASSETS: Fetcher
  KV_API_KEY?: string
  AZURE_API_KEY?: string  // ← Add this
  LOGS_API_KEY?: string
  MIGRATION_KEY?: string
  AZURE_SEARCH_ENDPOINT?: string
  AZURE_SEARCH_KEY?: string
}
```

And update `wrangler.toml`:
```toml
# Secrets (sensitive values - use: npx wrangler secret put <KEY_NAME>)
# npx wrangler secret put KV_API_KEY         # For /api/kv endpoints
# npx wrangler secret put AZURE_API_KEY      # For /api/azure-search endpoints
# npx wrangler secret put LOGS_API_KEY       # For /api/logs endpoints
# npx wrangler secret put MIGRATION_KEY      # For /api/migrate endpoint
```

---

## ** Migration Checklist **

### Phase 1: Add New Files
    - [] Create`src/lib/storage.ts`
        - [] Create`src/hooks/useStorage.ts`

### Phase 2: Replace Services
    - [] Replace`src/lib/services/query-history.ts`
        - [] Replace`src/lib/services/token-tracker.ts`
            - [] Fix `src/lib/azure-search.ts` token method

### Phase 3: Update All Imports
Find and replace across entire codebase:
```bash
# Find all files using old imports
grep -r "useSparkKV" src/
grep -r "spark-fallback" src/
grep -r "getActiveSparkKv" src/

# Replace:
useSparkKV → useStorage
getActiveSparkKv() → storage
spark-fallback → storage
```

### Phase 4: Delete Old Files
    - [] Delete`src/lib/spark-fallback.ts`
        - [] Delete`src/hooks/use-spark-kv.ts`
            - [] Delete`src/lib/cloudflare-kv.ts`

### Phase 5: Update Worker
    - [] Remove `/_spark/loaded` endpoint from`worker/index.ts`
        - [] Remove Spark origins from ALLOWED_ORIGINS
            - [] Add `AZURE_API_KEY` to Env interface
                - [] Update Azure Search handler to use`AZURE_API_KEY`

### Phase 6: Test
    - [] Test storage in dev(localStorage)
        - [] Test storage in production(Cloudflare KV)
            - [] Test token tracking persistence
                - [] Test query history persistence
                    - [] Test Azure Search proxy authentication

---

    Would you like me to show the replacements for any specific component files that import these services?
