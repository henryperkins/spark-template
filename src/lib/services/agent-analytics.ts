import type { AgentStepEvent, AgentAlertCode } from './telemetry'
import { analyticsBackend } from './analytics-backend'
import { toast } from 'sonner'
import type { CloudflareKVAdapter } from '@/lib/cloudflare-kv'
import { createCloudflareKV } from '@/lib/cloudflare-kv'
import { track } from '@/lib/runtime-telemetry'

interface AlertThresholds {
  longRunningMs: number
  consecutiveFailures: number
}

type FailureKey = string

interface SystemAlert {
  id: string
  severity: 'warning' | 'error'
  code: AgentAlertCode
  agent?: string
  message: string
  timestamp: string
  acknowledged: boolean
}

class AgentAnalytics {
  private readonly thresholds: AlertThresholds = {
    longRunningMs: 15000,
    consecutiveFailures: 1
  }

  private failureCounts = new Map<FailureKey, number>()
  private kv: CloudflareKVAdapter | null

  constructor(kv?: CloudflareKVAdapter | null) {
    // LocalStorage fallback adapter to match useStorage behavior
    const localStorageAdapter: CloudflareKVAdapter = {
      async keys(): Promise<string[]> {
        if (typeof window === 'undefined' || !window.localStorage) return []
        const keys: string[] = []
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (k) keys.push(k)
        }
        return keys
      },
      async get(key: string): Promise<unknown> {
        if (typeof window === 'undefined' || !window.localStorage) return undefined
        const raw = window.localStorage.getItem(key)
        if (!raw) return undefined
        try { return JSON.parse(raw) } catch { return raw }
      },
      async set(key: string, value: unknown): Promise<void> {
        if (typeof window === 'undefined' || !window.localStorage) return
        const payload = typeof value === 'string' ? value : JSON.stringify(value)
        window.localStorage.setItem(key, payload)
      },
      async delete(key: string): Promise<void> {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.removeItem(key)
      }
    }

    // Prefer provided adapter, otherwise Cloudflare KV, otherwise localStorage
    this.kv = (kv ?? createCloudflareKV()) || localStorageAdapter
  }

  recordStepEvent(event: AgentStepEvent): void {
    void analyticsBackend.send('agent_step_status', event)

    if (event.status === 'completed') {
      this.handleCompletion(event)
      return
    }

    if (event.status === 'failed') {
      this.handleFailure(event)
      return
    }

    if (event.status === 'running') {
      // No-op for running events beyond telemetry tracking.
      return
    }
  }

  private handleCompletion(event: AgentStepEvent): void {
    this.resetFailureCounter(event)

    if (event.duration && event.duration > this.thresholds.longRunningMs) {
      this.raiseAlert(event, 'long_running_step', 'warning')
    }
  }

  private handleFailure(event: AgentStepEvent): void {
    const key = this.failureKey(event)
    const current = this.failureCounts.get(key) ?? 0
    const next = current + 1
    this.failureCounts.set(key, next)

    if (next >= this.thresholds.consecutiveFailures) {
      this.raiseAlert(event, 'step_failure', 'error')
    }
  }

  private resetFailureCounter(event: AgentStepEvent): void {
    const key = this.failureKey(event)
    if (this.failureCounts.has(key)) {
      this.failureCounts.delete(key)
    }
  }

  private failureKey(event: AgentStepEvent): FailureKey {
    return `${event.runId}:${event.agent}:${event.action}`
  }

  private raiseAlert(
    event: AgentStepEvent,
    code: AgentAlertCode,
    severity: 'warning' | 'error'
  ): void {
    const alertPayload = {
      type: 'agent_step_alert' as const,
      runId: event.runId,
      query: event.query,
      agent: event.agent,
      action: event.action,
      stepIndex: event.stepIndex,
      severity,
      code,
      timestamp: new Date().toISOString()
    } as {
      type: 'agent_step_alert'
      runId: string
      query: string
      agent: string
      action: string
      stepIndex: number
      severity: 'warning' | 'error'
      code: AgentAlertCode
      timestamp: string
      duration?: number
      failureReason?: string
    }

    if (typeof event.duration === 'number') {
      alertPayload.duration = event.duration
    }
    if (event.failureReason) {
      alertPayload.failureReason = event.failureReason
    }

    void analyticsBackend.send('agent_step_alert', alertPayload)
    void track('agent_step_alert', alertPayload)

    // Show toast notification
    this.showAlertToast(alertPayload)

    // Persist alerts so AlertPanel can render them.
    void this.persistAlert(alertPayload).catch((err) => {
      if (import.meta.env?.MODE !== 'production') {
        console.warn('[agent-analytics] Failed to persist alert', err)
      }
    })
  }

  private async persistAlert(alert: {
    agent: string
    action: string
    code: AgentAlertCode
    severity: 'warning' | 'error'
    duration?: number
    failureReason?: string
    timestamp: string
    runId: string
    query: string
    stepIndex: number
  }): Promise<void> {
    const STORAGE_KEY = 'system-alerts'
    const nowMinus2Min = Date.now() - 120000

    const writeToLocal = (alerts: SystemAlert[]) => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts))
        }
      } catch {
        // Ignore localStorage write failures
      }
    }

    try {
      // Load existing alerts from configured storage (KV or local fallback)
      const existing = ((await this.kv?.get(STORAGE_KEY)) as SystemAlert[] | undefined) ?? []
      const message = this.formatAlertMessage(alert)

      const duplicate = existing.find((item) => {
        if (item.code !== alert.code) return false
        if (item.agent !== alert.agent) return false
        if (item.message !== message) return false
        const ts = new Date(item.timestamp).getTime()
        return Number.isFinite(ts) && ts >= nowMinus2Min
      })
      if (duplicate) return

      const systemAlert: SystemAlert = {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        severity: alert.severity,
        code: alert.code,
        agent: alert.agent,
        message,
        timestamp: alert.timestamp,
        acknowledged: false
      }

      const updated = [...existing, systemAlert].slice(-100)

      // Try primary adapter write
      await this.kv?.set(STORAGE_KEY, updated)
    } catch (error) {
      // On any KV error, attempt to persist to localStorage so AlertPanel still works
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(STORAGE_KEY) : null
        const parsed: SystemAlert[] = raw ? (() => { try { return JSON.parse(raw) } catch { return [] } })() : []
        const message = this.formatAlertMessage(alert)
        const duplicate = parsed.find((item) => {
          if (item.code !== alert.code) return false
          if (item.agent !== alert.agent) return false
          if (item.message !== message) return false
          const ts = new Date(item.timestamp).getTime()
          return Number.isFinite(ts) && ts >= nowMinus2Min
        })
        if (!duplicate) {
          const systemAlert: SystemAlert = {
            id:
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            severity: alert.severity,
            code: alert.code,
            agent: alert.agent,
            message,
            timestamp: alert.timestamp,
            acknowledged: false
          }
          parsed.push(systemAlert)
          writeToLocal(parsed.slice(-100))
        }
      } catch {
        // Ignore fallback localStorage errors
      }

      if (import.meta.env?.MODE !== 'production') {
        console.warn('[agent-analytics] KV persist error; used localStorage fallback', error)
      }
    }
  }

  private showAlertToast(alert: {
    agent: string
    action: string
    code: AgentAlertCode
    severity: 'warning' | 'error'
    duration?: number
    failureReason?: string
  }): void {
    const message = this.formatAlertMessage(alert)

    if (alert.severity === 'error') {
      toast.error(`Agent Error: ${alert.agent}`, {
        description: message,
        duration: 5000
      })
    } else {
      toast.warning(`Slow Step: ${alert.agent}`, {
        description: message,
        duration: 4000
      })
    }
  }

  private formatAlertMessage(alert: {
    action: string
    code: AgentAlertCode
    duration?: number
    failureReason?: string
  }): string {
    if (alert.code === 'long_running_step' && alert.duration) {
      return `${alert.action} took ${(alert.duration / 1000).toFixed(2)}s (threshold: 15s)`
    }

    if (alert.code === 'step_failure') {
      return alert.failureReason || `${alert.action} failed`
    }

    return alert.action
  }
}

export const agentAnalytics = new AgentAnalytics()
