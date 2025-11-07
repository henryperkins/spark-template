import { AgentStepEvent, AgentAlertCode, telemetry } from './telemetry'
import { analyticsBackend } from './analytics-backend'
import { toast } from 'sonner'

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
      duration: event.duration,
      failureReason: event.failureReason,
      severity,
      code,
      timestamp: new Date().toISOString()
    }

    void analyticsBackend.send('agent_step_alert', alertPayload)
    telemetry.trackAgentAlert({
      ...alertPayload
    })

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
    if (typeof window === 'undefined') return

    const sparkKV = (window as any)?.spark?.kv
    if (!sparkKV) return

    try {
      const existing = ((await sparkKV.get('system-alerts')) as SystemAlert[] | undefined) ?? []
      const message = this.formatAlertMessage(alert)
      const cutoff = Date.now() - 120000

      const duplicate = existing.find((item) => {
        if (item.code !== alert.code) return false
        if (item.agent !== alert.agent) return false
        if (item.message !== message) return false

        const timestamp = new Date(item.timestamp).getTime()
        return Number.isFinite(timestamp) && timestamp >= cutoff
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

      existing.push(systemAlert)

      const trimmed = existing.slice(-100)
      await sparkKV.set('system-alerts', trimmed)
    } catch (error) {
      if (import.meta.env?.MODE !== 'production') {
        console.warn('[agent-analytics] KV persist error', error)
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
