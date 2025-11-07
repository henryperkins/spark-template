import { kvCacheManagerAgent } from './kv-cache-manager-agent'
import type { DocAnalysisPing, DocAnalysisProgress } from './types'

export interface IHealthProgressAgent {
  heartbeat(runId: string, phase: DocAnalysisProgress['phase']): Promise<void>
  setProgress(progress: DocAnalysisProgress): Promise<void>
  readStatus(runId: string): Promise<{ ping: DocAnalysisPing | null; progress: DocAnalysisProgress | null }>
  isCancelled(runId: string): Promise<boolean>
}

export class HealthProgressAgent implements IHealthProgressAgent {
  async heartbeat(runId: string, phase: DocAnalysisProgress['phase']): Promise<void> {
    const ping: DocAnalysisPing = {
      runId,
      status: phase === 'complete' ? 'complete' : 'running',
      updatedAt: new Date().toISOString()
    }
    await kvCacheManagerAgent.setPing(ping).catch(() => void 0)
  }

  async setProgress(progress: DocAnalysisProgress): Promise<void> {
    await kvCacheManagerAgent.setProgress(progress).catch(() => void 0)
  }

  async readStatus(runId: string): Promise<{ ping: DocAnalysisPing | null; progress: DocAnalysisProgress | null }> {
    const [p1, p2] = await Promise.all([
      kvCacheManagerAgent.getPing(runId),
      kvCacheManagerAgent.getProgress(runId)
    ])
    return { ping: p1.ok ? p1.value : null, progress: p2.ok ? p2.value : null }
  }

  async isCancelled(runId: string): Promise<boolean> {
    const res = await kvCacheManagerAgent.isCancelled(runId)
    return res.ok ? res.value : false
  }
}

export const healthProgressAgent = new HealthProgressAgent()

