import { createCloudflareKV, type CloudflareKVAdapter } from '@/lib/cloudflare-kv'

export interface QueryHistoryEntry {
  id: string
  timestamp: string
  query: string

  routing: {
    strategy: 'vector' | 'keyword' | 'hybrid'
    reasoning: string
    confidence: number
  }

  resultCount: number
  topScore: number
  azureUsed: boolean
  azureFallback: boolean

  totalDuration: number
  retrievalDuration?: number
  retrievalAvgScore?: number

  workflow?: Array<{
    agent: string
    action: string
    duration: number
    status: string
  }>

  complexity?: 'simple' | 'moderate' | 'complex'
  requiresDecomposition?: boolean

  validation?: {
    faithfulnessScore: number
    relevanceScore: number
    isValid: boolean
  }

  // Optional enriched execution summary from orchestrator context
  executionSummary?: {
    totalDuration: number
    totalTokens: number
    totalCost: number
    llmCallCount: number
    warningCount: number
    budgetUtilization: {
      tokens: number
      time: number
    }
    phaseBreakdown: Record<string, number>
  }

  // NEW: Vector/Hybrid retrieval metadata (backward compatible)
  namespace?: string
  storeType?: 'azure' | 'in-memory'
  driftDetected?: boolean
  driftReasons?: string[]
}

const KV_KEY = 'query-history'
const MAX_ENTRIES = 100

class QueryHistoryService {
  private cache: QueryHistoryEntry[] | null = null
  private kv: CloudflareKVAdapter | null = null

  constructor(kv?: CloudflareKVAdapter | null) {
    this.kv = kv ?? createCloudflareKV()
  }

  private normalize(value: unknown): QueryHistoryEntry[] {
    if (!value) return []
    if (Array.isArray(value)) return value as QueryHistoryEntry[]
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown
        return Array.isArray(parsed) ? (parsed as QueryHistoryEntry[]) : []
      } catch {
        return []
      }
    }
    return []
  }

  private cloneHistory(entries: QueryHistoryEntry[]): QueryHistoryEntry[] {
    return entries.map(entry => ({
      ...entry,
      workflow: entry.workflow ? entry.workflow.map(step => ({ ...step })) : undefined,
      validation: entry.validation ? { ...entry.validation } : undefined,
      routing: { ...entry.routing },
      executionSummary: entry.executionSummary
        ? {
            ...entry.executionSummary,
            budgetUtilization: {
              ...(entry.executionSummary.budgetUtilization ?? {})
            },
            phaseBreakdown: {
              ...(entry.executionSummary.phaseBreakdown ?? {})
            }
          }
        : undefined,
    }))
  }

  private async load(): Promise<QueryHistoryEntry[]> {
    try {
      if (this.kv) {
        const value = await this.kv.get(KV_KEY)
        const normalized = this.normalize(value)
        if (normalized.length > 0) return normalized
      }
    } catch (error) {
      console.warn('QueryHistoryService: KV read failed, falling back to localStorage', error)
    }

    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(KV_KEY)
        if (raw) return this.normalize(raw)
      }
    } catch (error) {
      console.error('QueryHistoryService: localStorage read failed', error)
    }

    return []
  }

  private async persist(history: QueryHistoryEntry[]): Promise<void> {
    const payload = this.cloneHistory(history)
    const serialized = JSON.stringify(payload)

    // Try KV first
    try {
      if (this.kv) {
        await this.kv.set(KV_KEY, serialized)
        return
      }
    } catch (error) {
      console.warn('QueryHistoryService: KV write failed, falling back to localStorage', error)
    }

    // Fallback: localStorage
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KV_KEY, serialized)
    }
  }

  async add(entry: QueryHistoryEntry): Promise<void> {
    try {
      const history = await this.getAll()
      history.unshift(entry)
      if (history.length > MAX_ENTRIES) history.splice(MAX_ENTRIES)
      await this.persist(history)
      this.cache = history
    } catch (error) {
      console.error('Failed to add query to history:', error)
    }
  }

  async getAll(): Promise<QueryHistoryEntry[]> {
    try {
      if (this.cache) return this.cloneHistory(this.cache)
      const history = await this.load()
      this.cache = history
      return this.cloneHistory(this.cache)
    } catch (error) {
      console.error('Failed to load query history:', error)
      return []
    }
  }

  async getRecent(limit: number = 20): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    return all.slice(0, limit)
  }

  async search(term: string): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    const q = term.toLowerCase()
    return all.filter(e => e.query.toLowerCase().includes(q))
  }

  async getByStrategy(strategy: 'vector' | 'keyword' | 'hybrid'): Promise<QueryHistoryEntry[]> {
    const all = await this.getAll()
    return all.filter(e => e.routing.strategy === strategy)
  }

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
        strategyDistribution: { vector: 0, keyword: 0, hybrid: 0 },
      }
    }

    const totalDuration = all.reduce((sum, e) => sum + e.totalDuration, 0)
    const fallbackCount = all.filter(e => e.azureFallback).length
    const strategyDistribution = all.reduce((acc, e) => {
      acc[e.routing.strategy] = (acc[e.routing.strategy] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total: all.length,
      avgDuration: totalDuration / all.length,
      azureFallbackRate: fallbackCount / all.length,
      strategyDistribution,
    }
  }

  async clear(): Promise<void> {
    try {
      await this.persist([])
      this.cache = []
    } catch (error) {
      console.error('Failed to clear query history:', error)
    }
  }

  invalidateCache(): void {
    this.cache = null
  }
}

export const queryHistoryService = new QueryHistoryService()
