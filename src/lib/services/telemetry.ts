export type AgentStepStatus = 'running' | 'completed' | 'failed' | 'pending' | 'degraded'

export interface AgentStepEvent {
  type: 'agent_step_status'
  runId: string
  query: string
  agent: string
  action: string
  status: AgentStepStatus
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}

export type AgentAlertCode = 'long_running_step' | 'step_failure'

export interface AgentAlertEvent {
  type: 'agent_step_alert'
  runId: string
  query: string
  agent: string
  action: string
  severity: 'warning' | 'error'
  code: AgentAlertCode
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}

import { track as sendTelemetry } from '@/lib/runtime-telemetry'

type ProcessLike = {
  env?: Record<string, string | undefined>
}

type GlobalProcessContainer = {
  process?: ProcessLike
}

const isDevEnvironment = (): boolean => {
  try {
    return import.meta.env?.MODE !== 'production'
  } catch {
    const globalProcess = (globalThis as GlobalProcessContainer).process
    return globalProcess?.env?.NODE_ENV !== 'production'
  }
}

class TelemetryService {
  private track(eventName: string, payload: unknown): void {
    try {
      void sendTelemetry(eventName, payload)
    } catch (error) {
      if (isDevEnvironment()) {
        console.warn('Telemetry dispatch failed:', error)
      }
    }
  }

  trackAgentStep(event: AgentStepEvent): void {
    this.track('agent_step_status', event)
  }

  trackAgentAlert(event: AgentAlertEvent): void {
    this.track('agent_step_alert', event)
  }
}

export const telemetry = new TelemetryService()
