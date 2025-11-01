import { AgentStepEvent, AgentAlertCode, telemetry } from './telemetry'
import { analyticsBackend } from './analytics-backend'

interface AlertThresholds {
  longRunningMs: number
  consecutiveFailures: number
}

type FailureKey = string

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
  }
}

export const agentAnalytics = new AgentAnalytics()
