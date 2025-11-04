/**
 * Token and Cost Tracking Service
 * Monitors LLM token usage and estimates costs per model
 */

// Safe storage access that works in Spark environment
class StorageManager {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    // Try Spark KV first
    try {
      const spark = (window as unknown).spark
      if (spark?.kv) {
        const value = await spark.kv.get(key)
        return value ? String(value) : null
      }
    } catch {
      // Spark KV not available, continue to fallback
    }

    // Fallback to in-memory
    return this.store.get(key) || null
  }

  async set(key: string, value: string): Promise<void> {
    // Try Spark KV first
    try {
      const spark = (window as unknown).spark
      if (spark?.kv) {
        await spark.kv.set(key, value)
        return
      }
    } catch {
      // Spark KV not available, continue to fallback
    }

    // Fallback to in-memory
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    // Try Spark KV first
    try {
      const spark = (window as unknown).spark
      if (spark?.kv) {
        await spark.kv.delete(key)
        return
      }
    } catch {
      // Spark KV not available, continue to fallback
    }

    // Fallback to in-memory
    this.store.delete(key)
  }
}

const storage = new StorageManager()

export interface LLMUsageMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  modelUsed: string
  timestamp: string
  provider: 'azure' | 'spark'
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
   * Update daily usage counter (async to support Spark KV)
   */
  private async updateDailyUsage(tokens: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0]

    try {
      const lastUpdate = await storage.get('token-budget-date')

      if (lastUpdate !== today) {
        // New day, reset usage
        this.budget.currentUsage = tokens
        await storage.set('token-budget-date', today)
        await storage.set('token-budget-usage', tokens.toString())
      } else {
        // Same day, accumulate
        this.budget.currentUsage += tokens
        await storage.set('token-budget-usage', this.budget.currentUsage.toString())
      }
    } catch (error) {
      // Storage failed, continue with in-memory only
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
   * Get budget status (async to support Spark KV)
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
      const savedUsage = await storage.get('token-budget-usage')
      const savedDate = await storage.get('token-budget-date')
      const today = new Date().toISOString().split('T')[0]

      if (savedDate === today && savedUsage) {
        this.budget.currentUsage = parseInt(savedUsage, 10)
      } else if (savedDate !== today) {
        this.budget.currentUsage = 0
      }
    } catch (error) {
      // Storage failed, use current in-memory value
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
  getMetricsByModel(): Record<string, { count: number; totalTokens: number; totalCost: number }> {
    const byModel: Record<string, { count: number; totalTokens: number; totalCost: number }> = {}

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
      // Storage cleanup failed, but in-memory is reset
      console.warn('Failed to clear budget storage:', error)
    }
  }
}

export const tokenTracker = new TokenTracker()
