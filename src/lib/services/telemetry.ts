export type AgentStepStatus = 'running' | 'completed' | 'failed' | 'pending'

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

type TelemetrySink =
  | { track: (eventName: string, payload: unknown) => void }
  | { capture: (eventName: string, payload: unknown) => void }

interface SparkLike {
  telemetry?: TelemetrySink
  analytics?: TelemetrySink
  analyticsClient?: TelemetrySink
}

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
    if (typeof window === 'undefined') {
      return
    }

    const sparkContainer = window as unknown as { spark?: SparkLike }
    const spark = sparkContainer.spark
    const telemetry: TelemetrySink | undefined =
      spark?.telemetry || spark?.analytics || spark?.analyticsClient

    try {
      if (telemetry) {
        if ('track' in telemetry && typeof telemetry.track === 'function') {
          telemetry.track(eventName, payload)
          return
        }
        if ('capture' in telemetry && typeof telemetry.capture === 'function') {
          telemetry.capture(eventName, payload)
          return
        }
      }

      if (isDevEnvironment()) {
        console.debug(`[telemetry:${eventName}]`, payload)
      }
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
