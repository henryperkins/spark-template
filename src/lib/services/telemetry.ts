export type AgentStepStatus = 'running' | 'completed' | 'failed' | 'pending' | 'degraded'

/**
 * LLM metadata for cost tracking in telemetry.
 */
export interface LLMMetadata {
  model: string
  provider: 'azure' | 'worker'
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number
  temperature?: number
  maxTokens?: number
}

/**
 * Agent-specific metadata for telemetry enrichment.
 */
export interface AgentStepMetadata {
  // Classifier metadata
  complexity?: 'simple' | 'moderate' | 'complex'
  requiresDecomposition?: boolean

  // Router metadata
  strategy?: 'vector' | 'keyword' | 'hybrid'
  routingConfidence?: number

  // Planner metadata
  subQueryCount?: number
  executionStrategy?: 'sequential' | 'parallel'

  // Retrieval metadata
  sourceCount?: number
  avgRelevanceScore?: number
  degraded?: boolean

  // Validation metadata
  faithfulnessScore?: number
  relevanceScore?: number
  validationPassed?: boolean
  issueCount?: number

  // Refinement metadata
  iterations?: number
  improved?: boolean

  // NEW: Vector/Hybrid retrieval metadata (backward compatible)
  storeType?: 'azure' | 'in-memory'
  namespace?: string
  fusionLatencyMs?: number
  driftDetected?: boolean
  driftReasons?: string[]

  // Web vitals metadata
  source?: string
  metricName?: string
  metricValue?: number
  navigationType?: 'navigate' | 'reload' | 'back-forward' | 'back-forward-cache' | 'prerender' | 'restore'
}

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

  // Enriched fields for Gap #2
  llm?: LLMMetadata
  metadata?: AgentStepMetadata
  cumulativeTokens?: number
  cumulativeCost?: number
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
