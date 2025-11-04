import { getActiveSparkKv, fallbackKv } from '../spark-fallback'

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

  private normalize(value: unknown): QueryHistoryEntry[] {
    if (!value) {
      return []
    }

    if (Array.isArray(value)) {
      return value as QueryHistoryEntry[]
    }

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
    }))
  }

  private async loadFromKv(): Promise<QueryHistoryEntry[]> {
    try {
      const value = await getActiveSparkKv().get(KV_KEY)
      const normalized = this.normalize(value)
      if (normalized.length > 0) {
        return normalized
      }
    } catch (error) {
      console.warn('QueryHistoryService: primary KV read failed, attempting fallback', error)
    }

    try {
      const fallbackValue = await fallbackKv.get(KV_KEY)
      return this.normalize(fallbackValue)
    } catch (error) {
      console.error('QueryHistoryService: fallback KV read failed', error)
      return []
    }
  }

  private async persist(history: QueryHistoryEntry[]): Promise<void> {
    const payload = this.cloneHistory(history)

    try {
      await getActiveSparkKv().set(KV_KEY, payload)
    } catch (error) {
      console.warn('QueryHistoryService: primary KV write failed, attempting fallback', error)
      try {
        await fallbackKv.set(KV_KEY, payload)
      } catch (fallbackError) {
        console.error('QueryHistoryService: failed to persist query history to fallback KV', fallbackError)
        throw fallbackError
      }
    }
  }

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

      // Save to KV
      await this.persist(history)

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

      // Load from KV
      const history = await this.loadFromKv()
      this.cache = history
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
      await this.persist([])
      this.cache = []
    } catch (error) {
      console.error('Failed to clear query history:', error)
    }
  }

  /**
   * Invalidate cache (force reload from KV)
   */
  invalidateCache(): void {
    this.cache = null
  }
}

export const queryHistoryService = new QueryHistoryService()
