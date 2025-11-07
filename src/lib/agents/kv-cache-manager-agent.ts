import { cacheManager, getFromKVWithFallback } from '@/lib/cache-manager'

import type {
  AgentResult,
  DocAnalysisPing,
  DocAnalysisProgress,
} from './types'

// TTLs
const TTL_5_MIN = 5 * 60 * 1000
const TTL_10_MIN = 10 * 60 * 1000
const TTL_60_MIN = 60 * 60 * 1000

// Helper to build full cache key with versioning
function buildKey(logicalKey: string): string {
  // cacheManager already prefixes with cache:v2025.01:
  return logicalKey
}

// Minimal once-per-key warn suppression for guidance/config 404s is provided by getFromKVWithFallback

export interface IKVCacheManagerAgent {
  getDocAnalysisConfig(slug: string): Promise<AgentResult<string | null>>

  getProgress(runId: string): Promise<AgentResult<DocAnalysisProgress | null>>
  setProgress(progress: DocAnalysisProgress): Promise<AgentResult<null>>

  getPing(runId: string): Promise<AgentResult<DocAnalysisPing | null>>
  setPing(ping: DocAnalysisPing): Promise<AgentResult<null>>

  isCancelled(runId: string): Promise<AgentResult<boolean>>
  setCancelled(runId: string): Promise<AgentResult<null>>
}

export class KVCacheManagerAgent implements IKVCacheManagerAgent {
  async getDocAnalysisConfig(slug: string): Promise<AgentResult<string | null>> {
    try {
      const logical = `doc-analysis:${slug}.md`
      const fullKey = `cache:v2025.01:${logical}`
      const value = await getFromKVWithFallback<string>(
        fullKey,
        async (key) => {
          // Fetch through Worker to observe 404 semantics; Authorization header is handled by Worker
          const encoded = encodeURIComponent(key)
          const resp = await fetch(`/api/kv/${encoded}`, {
            method: 'GET',
            headers: { 'Authorization': this.getBearer() },
          })
          return resp
        },
        { parseJson: false, retries: 1 }
      )
      return { ok: true, value: value ?? null }
    } catch (error) {
      return {
        ok: false,
        error: {
          type: 'kv',
          code: 'KV_READ_FAIL',
          message: (error as Error)?.message || 'KV read error',
          retriable: true,
        }
      }
    }
  }

  async getProgress(runId: string): Promise<AgentResult<DocAnalysisProgress | null>> {
    try {
      const key = buildKey(`doc-analysis:progress:${runId}`)
      const value = await cacheManager.get<DocAnalysisProgress>(key)
      return { ok: true, value: value ?? null }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_READ_FAIL', message: (error as Error)?.message || 'KV read error', retriable: true }
      }
    }
  }

  async setProgress(progress: DocAnalysisProgress): Promise<AgentResult<null>> {
    try {
      const key = buildKey(`doc-analysis:progress:${progress.runId}`)
      await cacheManager.set<DocAnalysisProgress>(key, progress, TTL_10_MIN)
      this.log('DOC_ANALYSIS_PROGRESS_UPDATE', { runId: progress.runId, docSlug: progress.docSlug, phase: progress.phase, percent: progress.percent })
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_WRITE_FAIL', message: (error as Error)?.message || 'KV write error', retriable: true }
      }
    }
  }

  async getPing(runId: string): Promise<AgentResult<DocAnalysisPing | null>> {
    try {
      const key = buildKey(`doc-analysis:ping:${runId}`)
      const value = await cacheManager.get<DocAnalysisPing>(key)
      return { ok: true, value: value ?? null }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_READ_FAIL', message: (error as Error)?.message || 'KV read error', retriable: true }
      }
    }
  }

  async setPing(ping: DocAnalysisPing): Promise<AgentResult<null>> {
    try {
      const key = buildKey(`doc-analysis:ping:${ping.runId}`)
      await cacheManager.set<DocAnalysisPing>(key, ping, TTL_5_MIN)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_WRITE_FAIL', message: (error as Error)?.message || 'KV write error', retriable: true }
      }
    }
  }

  async isCancelled(runId: string): Promise<AgentResult<boolean>> {
    try {
      const key = buildKey(`doc-analysis:cancellation:${runId}`)
      const val = await cacheManager.get<string | boolean>(key)
      return { ok: true, value: Boolean(val) }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_READ_FAIL', message: (error as Error)?.message || 'KV read error', retriable: true }
      }
    }
  }

  async setCancelled(runId: string): Promise<AgentResult<null>> {
    try {
      const key = buildKey(`doc-analysis:cancellation:${runId}`)
      await cacheManager.set(key, true, TTL_60_MIN)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        error: { type: 'kv', code: 'KV_WRITE_FAIL', message: (error as Error)?.message || 'KV write error', retriable: true }
      }
    }
  }

  private getBearer(): string {
    // Worker expects Authorization: Bearer <KV_API_KEY>
    try {
      const envToken = (import.meta as any)?.env?.VITE_KV_API_KEY as string | undefined
      const local = typeof window !== 'undefined' ? window.localStorage?.getItem('KV_API_KEY') ?? undefined : undefined
      const token = local || envToken
      return token ? `Bearer ${token}` : ''
    } catch {
      return ''
    }
  }

  private log(event: string, meta?: Record<string, unknown>): void {
    try {
      console.info(JSON.stringify({ level: 'info', event, ...meta }))
    } catch { /* noop */ }
  }
}

export const kvCacheManagerAgent = new KVCacheManagerAgent()

