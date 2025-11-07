/**
 * Token and Cost Tracking Service
 * Monitors LLM token usage and estimates costs per model
 */

import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

class StorageManager {
  private store = new Map<string, string>()
  private kv: CloudflareKVAdapter | null = null
  private initialized = false

  private initialize() {
    if (!this.initialized) {
      this.kv = createCloudflareKV()
      this.initialized = true
      if (this.kv) {
        console.info('[token-tracker] Using Cloudflare KV for persistence')
      } else {
        console.info('[token-tracker] Using in-memory storage')
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
  provider: 'azure' | 'openai'
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
    }
  }

  async trackUsage(metrics: Omit<LLMUsageMetrics, 'timestamp'>): Promise<void> {
    const fullMetrics: LLMUsageMetrics = {
      ...metrics,
      timestamp: new Date().toISOString()
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
