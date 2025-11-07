/**
 * Token and Cost Tracking Service
 * Monitors LLM token usage and estimates costs per model
 */

import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

class StorageManager {
  private store = new Map<string, string>()
  private kv: CloudflareKVAdapter | null = null
  private initialized = false
  private static hasLogged = false

  private initialize() {
    if (!this.initialized) {
      this.kv = createCloudflareKV()
      this.initialized = true
      // Only log once per runtime to reduce noise
      if (!StorageManager.hasLogged) {
        if (this.kv) {
          console.info('[token-tracker] Using Cloudflare KV for persistence')
        } else {
          console.info('[token-tracker] Using in-memory storage')
        }
        StorageManager.hasLogged = true
      }
    }
  }

  async get(key: string): Promise<string | null> {
    this.initialize()
    if (this.kv) {
      try {
        const value = await this.kv.get(key)
        return value ? String(value) : null
      } catch {
        // Fall through to in-memory
      }
    }
    return this.store.get(key) || null
  }

  async set(key: string, value: string): Promise<void> {
    this.initialize()
    if (this.kv) {
      try {
        await this.kv.set(key, value)
        this.store.set(key, value)
        return
      } catch {
        // Fall through to in-memory
      }
    }
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.initialize()
    if (this.kv) {
      try {
        await this.kv.delete(key)
        this.store.delete(key)
        return
      } catch {
        // Fall through to in-memory
      }
    }
    this.store.delete(key)
  }
}

const storage = new StorageManager()

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
  provider: 'azure' | 'worker' | 'openai'
}

interface ModelPricing {
  promptCostPer1k: number
  completionCostPer1k: number
}

interface TokenBudget {
  dailyLimit: number
  currentUsage: number
  alertThreshold: number
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
  private maxMetricsRetention = 1000

  private readonly modelPricing: Record<string, ModelPricing> = {
    // Costs per 1K tokens (USD). Aligned with agent-context per-1M table.
    'gpt-4': { promptCostPer1k: 0.03, completionCostPer1k: 0.06 },
    'gpt-4-turbo': { promptCostPer1k: 0.01, completionCostPer1k: 0.03 },
    'gpt-4o': { promptCostPer1k: 0.005, completionCostPer1k: 0.015 },
    'gpt-4o-mini': { promptCostPer1k: 0.00015, completionCostPer1k: 0.0006 },
    'gpt-3.5-turbo': { promptCostPer1k: 0.0005, completionCostPer1k: 0.0015 },
    'default': { promptCostPer1k: 0.01, completionCostPer1k: 0.03 }
  }

  private getPricingForModel(model: string): ModelPricing {
    const normalized = (model || '').toLowerCase()
    if (normalized.includes('gpt-4o-mini')) return this.modelPricing['gpt-4o-mini']
    if (normalized.includes('gpt-4o')) return this.modelPricing['gpt-4o']
    if (normalized.includes('gpt-4-turbo')) return this.modelPricing['gpt-4-turbo']
    if (normalized.includes('gpt-4')) return this.modelPricing['gpt-4']
    if (normalized.includes('gpt-3.5')) return this.modelPricing['gpt-3.5-turbo']
    return this.modelPricing['default']
  }

  private calculateCost(promptTokens: number, completionTokens: number, pricing: ModelPricing): number {
    const promptCost = (promptTokens / 1000) * pricing.promptCostPer1k
    const completionCost = (completionTokens / 1000) * pricing.completionCostPer1k
    return promptCost + completionCost
  }

  async trackUsage(metrics: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    modelUsed: string
    provider: 'azure' | 'worker' | 'openai'
    timestamp?: string
  }): Promise<void> {
    const pricing = this.getPricingForModel(metrics.modelUsed)
    const estimatedCost = this.calculateCost(metrics.promptTokens, metrics.completionTokens, pricing)

    const fullMetrics: LLMUsageMetrics = {
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      totalTokens: metrics.totalTokens,
      estimatedCost,
      modelUsed: metrics.modelUsed,
      provider: metrics.provider,
      timestamp: metrics.timestamp || new Date().toISOString()
    }

    this.usageMetrics.push(fullMetrics)

    if (this.usageMetrics.length > this.maxMetricsRetention) {
      this.usageMetrics.shift()
    }

    try {
      await storage.set('llm-usage-metrics', JSON.stringify(this.usageMetrics))
    } catch (error) {
      console.warn('[token-tracker] Failed to persist metrics:', error)
    }
  }

  recordUsage(metrics: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    modelUsed: string
    provider: 'azure' | 'worker' | 'openai'
    timestamp?: string
  }): Promise<void> {
    return this.trackUsage(metrics)
  }

  async loadMetrics(): Promise<void> {
    try {
      const stored = await storage.get('llm-usage-metrics')
      if (stored) {
        this.usageMetrics = JSON.parse(stored) as LLMUsageMetrics[]
      }
    } catch (error) {
      console.warn('[token-tracker] Failed to load metrics:', error)
    }
  }

  getMetrics(): LLMUsageMetrics[] {
    return [...this.usageMetrics]
  }

  getMetricsByModel(): Record<string, ModelStats> {
    const byModel: Record<string, ModelStats> = {}
    for (const m of this.usageMetrics) {
      const key = m.modelUsed
      if (!byModel[key]) {
        byModel[key] = { count: 0, totalTokens: 0, totalCost: 0 }
      }
      byModel[key].count += 1
      byModel[key].totalTokens += m.totalTokens
      byModel[key].totalCost += m.estimatedCost
    }
    return byModel
  }

  getTotalUsage(): { tokens: number; cost: number } {
    return this.usageMetrics.reduce(
      (acc, m) => ({
        tokens: acc.tokens + m.totalTokens,
        cost: acc.cost + m.estimatedCost
      }),
      { tokens: 0, cost: 0 }
    )
  }

  getDailyUsage(date?: string): DailyUsageSummary {
    const targetDate = date || new Date().toISOString().split('T')[0]
    const dayMetrics = this.usageMetrics.filter(m =>
      m.timestamp.startsWith(targetDate)
    )

    const totalTokens = dayMetrics.reduce((sum, m) => sum + m.totalTokens, 0)
    const totalCost = dayMetrics.reduce((sum, m) => sum + m.estimatedCost, 0)
    const queryCount = dayMetrics.length

    return {
      date: targetDate,
      totalTokens,
      totalCost,
      queryCount,
      avgTokensPerQuery: queryCount > 0 ? totalTokens / queryCount : 0,
      avgCostPerQuery: queryCount > 0 ? totalCost / queryCount : 0
    }
  }

  async setBudget(budget: TokenBudget): Promise<void> {
    try {
      await storage.set('token-budget', JSON.stringify(budget))
    } catch (error) {
      console.warn('[token-tracker] Failed to save budget:', error)
    }
  }

  async getBudget(): Promise<TokenBudget | null> {
    try {
      const stored = await storage.get('token-budget')
      return stored ? (JSON.parse(stored) as TokenBudget) : null
    } catch (error) {
      console.warn('[token-tracker] Failed to load budget:', error)
      return null
    }
  }

  async getBudgetStatus(): Promise<{
    dailyLimit: number
    currentUsage: number
    percentageUsed: number
    remainingTokens: number
    isNearLimit: boolean
    isOverLimit: boolean
  }> {
    const budget = await this.getBudget()
    const daily = this.getDailyUsage()

    const dailyLimit = budget?.dailyLimit ?? 1_000_000
    const currentUsage = daily.totalTokens
    const percentageUsed = dailyLimit > 0 ? (currentUsage / dailyLimit) * 100 : 0
    const remainingTokens = Math.max(0, dailyLimit - currentUsage)
    const alertThreshold = budget?.alertThreshold ?? 80

    return {
      dailyLimit,
      currentUsage,
      percentageUsed,
      remainingTokens,
      isNearLimit: percentageUsed >= alertThreshold,
      isOverLimit: percentageUsed >= 100
    }
  }

  async checkBudgetAlert(): Promise<{ exceeded: boolean; percentage: number } | null> {
    const budget = await this.getBudget()
    if (!budget) return null

    const dailyUsage = this.getDailyUsage()
    const percentage = (dailyUsage.totalTokens / budget.dailyLimit) * 100

    return {
      exceeded: percentage >= budget.alertThreshold,
      percentage
    }
  }
}

export const tokenTracker = new TokenTracker()
tokenTracker.loadMetrics()
