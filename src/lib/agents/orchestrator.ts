import { Document, Source } from '@/types'
import { QueryClassifierAgent, QueryClassification } from './query-classifier'
import { QueryPlannerAgent, QueryPlan } from './query-planner'
import { RoutingAgent, RoutingDecision, RetrievalStrategy } from './routing-agent'
import { CriticAgent, ValidationResult } from './critic-agent'
import { ReActAgent, ReActResult } from './react-agent'
import { QueryExpansionAgent, QueryExpansion } from './query-expansion'
import { findRelevantChunks, findRelevantChunksLocal, generateResponse } from '../rag'
import { azureServiceManager } from '../azure-service-manager'
import { AgentStepEvent, telemetry } from '../services/telemetry'
import { agentAnalytics } from '../services/agent-analytics'
import { errorTracking } from '../services/error-tracker'
import { queryHistoryService } from '../services/query-history'

export interface AgentWorkflowStep {
  agent: string
  action: string
  result: unknown
  timestamp: string
  duration?: number
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface AgenticRAGResult {
  response: string
  sources: Source[]
  classification: QueryClassification
  routing?: RoutingDecision
  plan?: QueryPlan
  validation?: ValidationResult
  refinement?: ReActResult
  expansion?: QueryExpansion
  workflow: AgentWorkflowStep[]
  totalDuration: number
  azureFallback: boolean
}

export interface ProcessQueryOptions {
  runId?: string
  onWorkflowUpdate?: (workflow: AgentWorkflowStep[]) => void
  onStepEvent?: (event: AgentStepEvent) => void
}

export class AgenticOrchestrator {
  private classifierAgent = new QueryClassifierAgent()
  private plannerAgent = new QueryPlannerAgent()
  private routingAgent = new RoutingAgent()
  private criticAgent = new CriticAgent()
  private reactAgent = new ReActAgent()
  private expansionAgent = new QueryExpansionAgent()

  async processQuery(
    query: string,
    documents: Document[],
    options: ProcessQueryOptions = {}
  ): Promise<AgenticRAGResult> {
    const startTime = Date.now()
    let azureFallback = false
    const workflow: AgentWorkflowStep[] = []
    const runId = options.runId ?? this.generateRunId()
    const emitWorkflowUpdate = () => {
      if (options.onWorkflowUpdate) {
        options.onWorkflowUpdate(workflow.map(step => ({ ...step })))
      }
    }
    const emitStepEvent = (
      event: Omit<AgentStepEvent, 'type' | 'runId' | 'query' | 'timestamp'> & { timestamp?: string }
    ) => {
      const enriched: AgentStepEvent = {
        type: 'agent_step_status',
        runId,
        query,
        timestamp: event.timestamp ?? new Date().toISOString(),
        ...event
      }
      telemetry.trackAgentStep(enriched)
      agentAnalytics.recordStepEvent(enriched)
      options.onStepEvent?.(enriched)
    }

    const classification = await this.executeStep(
      workflow,
      'Classifier',
      'Classify query complexity',
      () => this.classifierAgent.classifyQuery(query),
      emitWorkflowUpdate,
      emitStepEvent
    )

    let allSources: Source[] = []
    let plan: QueryPlan | undefined
    let routing: RoutingDecision | undefined

    if (classification.requiresDecomposition) {
      plan = await this.executeStep(
      workflow,
      'Planner',
      'Create query plan',
      () => this.plannerAgent.createPlan(query, classification.estimatedSubQueries),
      emitWorkflowUpdate,
      emitStepEvent
    )

      allSources = await this.executeSubQueries(
        plan,
        documents,
        workflow,
        emitWorkflowUpdate,
        emitStepEvent,
        () => {
          azureFallback = true
        }
      )
    } else {
      routing = await this.executeStep(
      workflow,
      'Router',
      'Select retrieval strategy',
      () => this.routingAgent.selectStrategy(query, { totalDocuments: documents.length }),
      emitWorkflowUpdate,
      emitStepEvent
    )

      allSources = await this.executeStep(
      workflow,
      'Retrieval',
      `Execute ${routing.strategy} search`,
      () => this.executeRetrieval(query, documents, routing!.strategy, () => {
        azureFallback = true
      }),
      emitWorkflowUpdate,
      emitStepEvent
    )
    }

    let response = await this.executeStep(
      workflow,
      'Generator',
      allSources.length > 0 ? 'Generate initial response' : 'Generate diagnostic message (no sources)',
      () => (allSources.length > 0
        ? generateResponse(query, allSources)
        : Promise.resolve(this.buildNoSourcesMessage(query, documents, routing?.strategy))),
      emitWorkflowUpdate,
      emitStepEvent
    )

    let validation: ValidationResult | undefined
    if (allSources.length > 0) {
      validation = await this.executeStep(
        workflow,
        'Critic',
        'Validate response quality',
        () => this.criticAgent.validateResponse(query, response, allSources),
        emitWorkflowUpdate,
        emitStepEvent
      )
    }

    let refinement: ReActResult | undefined

    if (validation && (!validation.isValid || validation.faithfulnessScore < 0.7)) {
      refinement = await this.executeStep(
        workflow,
        'ReAct',
        'Refine response iteratively',
        () => this.reactAgent.refineResponse(
          query,
          response,
          allSources,
          validation!.issues
        ),
        emitWorkflowUpdate,
        emitStepEvent
      )

      if (refinement.improved) {
        response = refinement.finalResponse
      }
    }

    const expansion = await this.executeStep(
      workflow,
      'Expansion',
      'Generate related questions',
      () => this.expansionAgent.expandQuery(query, documents, allSources),
      emitWorkflowUpdate,
      emitStepEvent
    )

    const totalDuration = Date.now() - startTime

    const result = {
      response,
      sources: allSources,
      classification,
      routing,
      plan,
      validation,
      refinement,
      expansion,
      workflow,
      totalDuration,
      azureFallback
    }

    // Log to query history (async, don't block return)
    queryHistoryService.add({
      id: runId,
      timestamp: new Date().toISOString(),
      query,
      routing: routing ? {
        strategy: routing.strategy,
        reasoning: routing.reasoning,
        confidence: routing.confidence
      } : {
        strategy: 'hybrid',
        reasoning: 'Query decomposed into sub-queries',
        confidence: 1.0
      },
      resultCount: allSources.length,
      topScore: allSources[0]?.relevanceScore || 0,
      azureUsed: azureServiceManager.isConfigured(),
      azureFallback,
      totalDuration,
      workflow: workflow.map(s => ({
        agent: s.agent,
        action: s.action,
        duration: s.duration || 0,
        status: s.status
      })),
      complexity: classification.complexity,
      requiresDecomposition: classification.requiresDecomposition,
      validation: validation ? {
        faithfulnessScore: validation.faithfulnessScore,
        relevanceScore: validation.relevanceScore,
        isValid: validation.isValid
      } : undefined
    }).catch(error => {
      console.error('Failed to log query to history:', error)
    })

    return result
  }

  private async executeStep<T>(
    workflow: AgentWorkflowStep[],
    agent: string,
    action: string,
    fn: () => Promise<T>,
    emitWorkflowUpdate?: () => void,
    emitStepEvent?: (
      event: Omit<AgentStepEvent, 'type' | 'runId' | 'query' | 'timestamp'> & { timestamp?: string }
    ) => void
  ): Promise<T> {
    const stepStart = Date.now()
    const runningStep: AgentWorkflowStep = {
      agent,
      action,
      result: null,
      timestamp: new Date().toISOString(),
      status: 'running'
    }
    workflow.push(runningStep)
    emitWorkflowUpdate?.()
    const stepIndex = workflow.length - 1
    emitStepEvent?.({
      agent,
      action,
      status: 'running',
      stepIndex
    })

    try {
      const result = await fn()
      const duration = Date.now() - stepStart

      workflow[stepIndex] = {
        ...runningStep,
        result,
        timestamp: new Date().toISOString(),
        duration,
        status: 'completed'
      }
      emitWorkflowUpdate?.()
      emitStepEvent?.({
        agent,
        action,
        status: 'completed',
        stepIndex,
        duration
      })

      return result
    } catch (error) {
      const duration = Date.now() - stepStart

      // Track error
      if (error instanceof Error) {
        errorTracking.record(error, {
          agent,
          type: this.getErrorTypeForAgent(agent),
          code: error.name
        })
      }

      workflow[stepIndex] = {
        ...runningStep,
        action: `${action} (failed)`,
        result: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toISOString(),
        duration,
        status: 'failed'
      }
      emitWorkflowUpdate?.()
      emitStepEvent?.({
        agent,
        action,
        status: 'failed',
        stepIndex,
        duration,
        failureReason: error instanceof Error ? error.message : 'Unknown error'
      })

      throw error
    }
  }

  private getErrorTypeForAgent(agent: string): 'retrieval' | 'llm' | 'unknown' {
    if (agent === 'Retrieval' || agent === 'Router') {
      return 'retrieval'
    }
    if (agent === 'Generator' || agent === 'Classifier' || agent === 'Planner' || agent === 'Critic' || agent === 'ReAct' || agent === 'Expansion') {
      return 'llm'
    }
    return 'unknown'
  }

  private async executeSubQueries(
    plan: QueryPlan,
    documents: Document[],
    workflow: AgentWorkflowStep[],
    emitWorkflowUpdate?: () => void,
    emitStepEvent?: (
      event: Omit<AgentStepEvent, 'type' | 'runId' | 'query' | 'timestamp'> & { timestamp?: string }
    ) => void,
    onAzureFallback?: () => void
  ): Promise<Source[]> {
    const allSources: Source[] = []
    const sortedSubQueries = [...plan.subQueries].sort((a, b) => a.priority - b.priority)

    if (plan.executionStrategy === 'parallel') {
      const results = await Promise.all(
        sortedSubQueries.map(sq =>
          this.executeStep(
            workflow,
            'Retrieval',
            `Execute sub-query: ${sq.query.substring(0, 40)}...`,
            async () => {
              const routingDecision = await this.executeStep(
                workflow,
                'Router',
                `Select strategy for sub-query: ${sq.id}`,
                () => this.routingAgent.selectStrategy(sq.query, { totalDocuments: documents.length }),
                emitWorkflowUpdate,
                emitStepEvent
              )

              return findRelevantChunks(sq.query, documents, 3, routingDecision.strategy, {
                onAzureFallback,
              })
            },
            emitWorkflowUpdate,
            emitStepEvent
          )
        )
      )

      results.forEach(sources => {
        sources.forEach(source => {
          if (!allSources.some(s => s.chunkId === source.chunkId)) {
            allSources.push(source)
          }
        })
      })
    } else {
      for (const sq of sortedSubQueries) {
        const routingDecision = await this.executeStep(
          workflow,
          'Router',
          `Select strategy for sub-query: ${sq.id}`,
          () => this.routingAgent.selectStrategy(sq.query, { totalDocuments: documents.length }),
          emitWorkflowUpdate,
          emitStepEvent
        )

        const sources = await this.executeStep(
          workflow,
          'Retrieval',
          `Execute sub-query: ${sq.query.substring(0, 40)}...`,
          () => findRelevantChunks(sq.query, documents, 3, routingDecision.strategy, {
            onAzureFallback,
          }),
          emitWorkflowUpdate,
          emitStepEvent
        )

        sources.forEach(source => {
          if (!allSources.some(s => s.chunkId === source.chunkId)) {
            allSources.push(source)
          }
        })
      }
    }

    return allSources.slice(0, 8)
  }

  private async executeRetrieval(
    query: string,
    documents: Document[],
    strategy: RetrievalStrategy,
    onAzureFallback?: () => void
  ): Promise<Source[]> {
    if (!azureServiceManager.isConfigured()) {
      return findRelevantChunks(query, documents, 5, strategy)
    }

    try {
      return await findRelevantChunks(query, documents, 5, strategy, {
        onAzureFallback,
      })
    } catch (error) {
      console.warn('Primary retrieval path failed, using local fallback:', error)

      // Track retrieval error
      if (error instanceof Error) {
        errorTracking.record(error, {
          type: 'retrieval',
          code: 'RETRIEVAL_FALLBACK'
        })
      }

      onAzureFallback?.()

      return findRelevantChunksLocal(query, documents, 5)
    }
  }

  private buildNoSourcesMessage(query: string, documents: Document[], strategy?: RetrievalStrategy): string {
    const totalDocs = documents.length
    const totalChunks = documents.reduce((acc, d) => acc + (d.chunks?.length || 0), 0)
    const strat = strategy ?? 'hybrid'
    return [
      `I could not retrieve any sources for "${query}".`,
      `Detected ${totalDocs} documents with ${totalChunks} chunks in the knowledge base.`,
      `This indicates a retrieval issue (strategy=${strat}).`,
      `Try re-running or refining the query; if the issue persists, check indexing and hybrid search settings.`
    ].join(' ')
  }

  private generateRunId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `run-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  }
}
