import { Document, Source } from '@/types'
import { QueryClassifierAgent, QueryClassification } from './query-classifier'
import { QueryPlannerAgent, QueryPlan } from './query-planner'
import { RoutingAgent, RoutingDecision, RetrievalStrategy } from './routing-agent'
import { CriticAgent, ValidationResult } from './critic-agent'
import { ReActAgent, ReActResult } from './react-agent'
import { QueryExpansionAgent, QueryExpansion } from './query-expansion'
import { cacheManager } from '../cache-manager'
import { DocumentAnalyzerAgent } from './document-analyzer'
import type { ChunkingDecision } from './types'
import { healthProgressAgent } from './health-progress-agent'
import { findRelevantChunks, findRelevantChunksLocal, findRelevantChunksWithMeta, generateResponse } from '../rag'
import { azureServiceManager } from '../azure-service-manager'
import { AgentStepEvent, telemetry, type AgentStepMetadata } from '../services/telemetry'
import { setActiveQueryContext, getActiveQueryContext } from './context-registry'
import { agentAnalytics } from '../services/agent-analytics'
import { errorTracking } from '../services/error-tracker'
import { queryHistoryService, type QueryHistoryEntry } from '../services/query-history'
import { tokenTracker } from '../services/token-tracker'
import { llmService } from '../services/llm-service'
import {
  buildKBContext,
  createQueryExecutionContext,
  recordPhaseTime,
  getExecutionSummary,
  canAffordTokens,
  addWarning,
  type RetrievalMetadata
} from './agent-context'

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

  // Enriched context data (Gap #1 & #2)
  executionSummary?: {
    totalTokens: number
    totalCost: number
    llmCallCount: number
    warningCount: number
    budgetUtilization: {
      tokens: number
      time: number
    }
    phaseBreakdown: Record<string, number>
  }
}

export interface ProcessQueryOptions {
  runId?: string
  onWorkflowUpdate?: (workflow: AgentWorkflowStep[]) => void
  onStepEvent?: (event: AgentStepEvent) => void
}

const buildMetadata = (metadata: AgentStepMetadata): AgentStepMetadata | undefined => {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined)
  if (entries.length === 0) {
    return undefined
  }
  return Object.fromEntries(entries) as AgentStepMetadata
}

export class AgenticOrchestrator {
  private classifierAgent = new QueryClassifierAgent()
  private plannerAgent = new QueryPlannerAgent()
  private routingAgent = new RoutingAgent()
  private criticAgent = new CriticAgent()
  private reactAgent = new ReActAgent()
  private expansionAgent = new QueryExpansionAgent()
  private docAnalyzer = new DocumentAnalyzerAgent()

  async processQuery(
    query: string,
    documents: Document[],
    options: ProcessQueryOptions = {}
  ): Promise<AgenticRAGResult> {
    const startTime = Date.now()
    const runId = options.runId ?? this.generateRunId()

    // Initialize execution context with KB awareness
    const kb = buildKBContext(documents)
    const context = createQueryExecutionContext(runId, query, kb, {
      tokenBudget: 50000, // 50k token budget
      timeBudgetMs: 60000 // 60s time budget
    })

    // Expose context to lower-level services (e.g., LLMService) for per-call recording
    setActiveQueryContext(context)

    try {
      // Ensure persisted metrics are loaded before taking baseline to avoid inheriting historical totals.
      await tokenTracker.ready

      // Track baseline usage so we can approximate per-run consumption
      const baselineUsage = tokenTracker.getTotalUsage()
      const syncTokenBudget = () => {
        const current = tokenTracker.getTotalUsage()
        const consumedTokens = Math.max(0, current.tokens - baselineUsage.tokens)
        const consumedCost = Math.max(0, current.cost - baselineUsage.cost)
        context.tokenBudget.consumed = consumedTokens
        context.tokenBudget.costConsumed = consumedCost
        context.tokenBudget.remaining = Math.max(
          0,
          context.tokenBudget.total - context.tokenBudget.consumed
        )
        context.tokenBudget.exhausted = context.tokenBudget.remaining === 0
      }

      let azureFallback = false
      const workflow: AgentWorkflowStep[] = []

      const emitWorkflowUpdate = () => {
        if (options.onWorkflowUpdate) {
          options.onWorkflowUpdate(workflow.map(step => ({ ...step })))
        }
      }

      // Gap #2: Enriched telemetry emission with tokens/cost
      const emitStepEvent = (
        event: Omit<AgentStepEvent, 'type' | 'runId' | 'query' | 'timestamp'> & {
          timestamp?: string
          metadata?: AgentStepMetadata
        }
      ) => {
        // Update budget from token tracker before emitting
        syncTokenBudget()

        const { llm: providedLLM, metadata, timestamp, ...rest } = event

        // Respect any llm metadata explicitly provided by the caller (e.g., executeStep),
        // and only fall back to the last LLM metadata when the event did not set it.
        const llm = providedLLM ?? llmService.getLastLLMMetadata() ?? undefined
        const cleanedMetadata = metadata ? buildMetadata(metadata) : undefined

        const enriched: AgentStepEvent = {
          type: 'agent_step_status',
          runId,
          query,
          timestamp: timestamp ?? new Date().toISOString(),
          ...rest,
          // Add cumulative token/cost from context
          cumulativeTokens: context.tokenBudget.consumed,
          cumulativeCost: context.tokenBudget.costConsumed
        }

        if (llm) {
          enriched.llm = llm
        }
        if (cleanedMetadata) {
          enriched.metadata = cleanedMetadata
        }

        telemetry.trackAgentStep(enriched)
        agentAnalytics.recordStepEvent(enriched)
        options.onStepEvent?.(enriched)
      }

      // Classification phase with timing and KB-aware classification (Gap #1)
      const classificationStart = Date.now()
      const classification = await this.executeStep(
        workflow,
        'Classifier',
        'Classify query complexity',
        () => this.classifierAgent.classifyQuery(query, kb), // Pass KB context
        emitWorkflowUpdate,
        event => {
          // Enrich with classification metadata (Gap #2)
          const classificationResult = (event as { result?: QueryClassification }).result
          const classificationMetadata: AgentStepMetadata = {}
          if (classificationResult?.complexity) {
            classificationMetadata.complexity = classificationResult.complexity
          }
          if (classificationResult?.requiresDecomposition !== undefined) {
            classificationMetadata.requiresDecomposition = classificationResult.requiresDecomposition
          }
          const metadata = buildMetadata(classificationMetadata)
          emitStepEvent({
            ...event,
            ...(metadata ? { metadata } : {})
          })
        }
      )
      const classificationDuration = Date.now() - classificationStart
      recordPhaseTime(context, 'classification', classificationDuration)

      // Store classification in context
      context.classification = classification

      let allSources: Source[] = []
      let plan: QueryPlan | undefined
      let routing: RoutingDecision | undefined
      let retrievalDurationMs = 0

      if (classification.requiresDecomposition) {
        // Planning phase with timing
        const planningStart = Date.now()
        plan = await this.executeStep(
          workflow,
          'Planner',
          'Create query plan',
          () =>
            this.plannerAgent.createPlan(
              query,
              classification.estimatedSubQueries,
              kb
            ), // Pass KB
        emitWorkflowUpdate,
        event => {
          const planResult = (event as { result?: QueryPlan }).result
          const planMetadata: AgentStepMetadata = {}
          if (planResult?.subQueries.length) {
            planMetadata.subQueryCount = planResult.subQueries.length
          }
          if (planResult?.executionStrategy) {
            planMetadata.executionStrategy = planResult.executionStrategy
          }
          const metadata = buildMetadata(planMetadata)
          emitStepEvent({
            ...event,
            ...(metadata ? { metadata } : {})
          })
        }
      )
        const planningDuration = Date.now() - planningStart
        recordPhaseTime(context, 'planning', planningDuration)
        context.plan = plan

        // Retrieval phase (sub-queries)
        const retrievalStart = Date.now()
        allSources = await this.executeSubQueries(
          plan,
          documents,
          workflow,
          emitWorkflowUpdate,
          emitStepEvent,
          () => {
            azureFallback = true
            context.azureFallback = true
          },
          kb // Pass KB to sub-queries
        )
        const retrievalDuration = Date.now() - retrievalStart
        retrievalDurationMs = retrievalDuration
        recordPhaseTime(context, 'retrieval', retrievalDuration)
        // Populate retrieval metadata for decomposed (sub-query) path
        context.retrievalMetadata = {
          strategy: 'hybrid',
          sourceCount: allSources.length,
          avgRelevanceScore: allSources.length
            ? allSources.reduce((sum, s) => sum + (s.relevanceScore ?? 0), 0) /
              allSources.length
            : 0,
          duration: retrievalDuration,
          degraded: azureFallback,
          ...(azureFallback
            ? { degradationReason: 'Azure retrieval fallback used during sub-queries' }
            : {})
        }
      } else {
        // Routing phase with timing
        const routingStart = Date.now()
        routing = await this.executeStep(
          workflow,
          'Router',
          'Select retrieval strategy',
          () => this.routingAgent.selectStrategy(query, kb), // Pass KB
          emitWorkflowUpdate,
          event => {
            const decision = (event as { result?: RoutingDecision }).result
            const routingMetadata: AgentStepMetadata = {}
            if (decision?.strategy) {
              routingMetadata.strategy = decision.strategy
            }
            if (decision?.confidence !== undefined) {
              routingMetadata.routingConfidence = decision.confidence
            }
            const metadata = buildMetadata(routingMetadata)
            emitStepEvent({
              ...event,
              ...(metadata ? { metadata } : {})
            })
          }
        )
        const routingDuration = Date.now() - routingStart
        recordPhaseTime(context, 'routing', routingDuration)
        context.routing = routing

        // Retrieval phase
        const retrievalStart = Date.now()
        const retrievalResult = await this.executeStep(
          workflow,
          'Retrieval',
          `Execute ${routing.strategy} search`,
          () => {
            const namespaceId = azureServiceManager.getNamespaceId()
            return findRelevantChunksWithMeta(query, documents, 5, routing!.strategy, {
              onAzureFallback: () => {
                azureFallback = true
                context.azureFallback = true
              },
              ...(namespaceId ? { namespaceId } : {})
            })
          },
          emitWorkflowUpdate,
          event => {
            const result = (event as {
              result?: { sources: Source[]; metadata: RetrievalMetadata }
            }).result
            const meta = result?.metadata
            if (meta) {
              const retrievalMetadata: AgentStepMetadata = {
                strategy: meta.strategy,
                sourceCount: meta.sourceCount,
                avgRelevanceScore: meta.avgRelevanceScore,
                degraded: meta.degraded
              }
              const metadata = buildMetadata(retrievalMetadata)
              emitStepEvent({
                ...event,
                ...(metadata ? { metadata } : {})
              })
            } else {
              emitStepEvent(event)
            }
          }
        )
        allSources = retrievalResult.sources
        const retrievalDuration = Date.now() - retrievalStart
        retrievalDurationMs = retrievalDuration
        recordPhaseTime(context, 'retrieval', retrievalDuration)
        // Populate retrieval metadata for single-query path
        context.retrievalMetadata = retrievalResult.metadata
      }

      // Generation phase with timing
      const generationStart = Date.now()
      let response = await this.executeStep(
        workflow,
        'Generator',
        allSources.length > 0
          ? 'Generate initial response'
          : 'Generate diagnostic message (no sources)',
        () =>
          allSources.length > 0
            ? generateResponse(query, allSources)
            : Promise.resolve(
                this.buildNoSourcesMessage(query, documents, routing?.strategy)
              ),
        emitWorkflowUpdate,
        emitStepEvent
      )
      const generationDuration = Date.now() - generationStart
      recordPhaseTime(context, 'generation', generationDuration)

      // Validation phase with timing
      let validation: ValidationResult | undefined
      if (allSources.length > 0) {
        const validationStart = Date.now()
        validation = await this.executeStep(
          workflow,
          'Critic',
          'Validate response quality',
          () =>
            this.criticAgent.validateResponse(
              query,
              response,
              allSources,
              kb
            ), // Pass KB
          emitWorkflowUpdate,
          event => {
            const validationResult = (event as {
              result?: ValidationResult
            }).result
            const validationMetadata: AgentStepMetadata = {}
            if (validationResult?.faithfulnessScore !== undefined) {
              validationMetadata.faithfulnessScore = validationResult.faithfulnessScore
            }
            if (validationResult?.relevanceScore !== undefined) {
              validationMetadata.relevanceScore = validationResult.relevanceScore
            }
            if (validationResult?.isValid !== undefined) {
              validationMetadata.validationPassed = validationResult.isValid
            }
            if (validationResult?.issues.length) {
              validationMetadata.issueCount = validationResult.issues.length
            }
            const metadata = buildMetadata(validationMetadata)
            emitStepEvent({
              ...event,
              ...(metadata ? { metadata } : {})
            })
          }
        )
        const validationDuration = Date.now() - validationStart
        recordPhaseTime(context, 'validation', validationDuration)
        context.validation = validation
      }

      // Refinement phase with timing
      let refinement: ReActResult | undefined
      if (
        validation &&
        (!validation.isValid || validation.faithfulnessScore < 0.7)
      ) {
        // If we cannot afford at least ~1000 tokens, skip refinement gracefully
        if (!canAffordTokens(context, 1000)) {
          addWarning(
            context,
            'refinement',
            'budget_exceeded',
            'Skipped refinement due to token budget'
          )
        } else {
          const refinementStart = Date.now()
          refinement = await this.executeStep(
            workflow,
            'ReAct',
            'Refine response iteratively',
            () =>
              this.reactAgent.refineResponse(
                query,
                response,
                allSources,
                validation!.issues,
                {
                  remainingTokenBudget: context.tokenBudget.remaining,
                  minTokensPerIteration: 1500
                },
                kb
              ),
            emitWorkflowUpdate,
            event => {
              const refinementResult = (event as { result?: ReActResult }).result
              const refinementMetadata: AgentStepMetadata = {}
              if (refinementResult?.iterations !== undefined) {
                refinementMetadata.iterations = refinementResult.iterations
              }
              if (refinementResult?.improved !== undefined) {
                refinementMetadata.improved = refinementResult.improved
              }
              const metadata = buildMetadata(refinementMetadata)
              emitStepEvent({
                ...event,
                ...(metadata ? { metadata } : {})
              })
            }
          )
          const refinementDuration = Date.now() - refinementStart
          recordPhaseTime(context, 'refinement', refinementDuration)
          context.refinement = refinement

          if (refinement.improved) {
            response = refinement.finalResponse
          }
        }
      }

      // Expansion phase with timing
      let expansion: QueryExpansion
      if (!canAffordTokens(context, 5000)) {
        // Budget guard: skip expansion
        addWarning(
          context,
          'expansion',
          'budget_exceeded',
          'Skipped expansion due to token budget'
        )
        const stepStart = Date.now()
        // Emit a degraded step so UI/telemetry reflect the skip
        const skippedStep = {
          agent: 'Expansion',
          action:
            'Generate related questions (skipped: token budget)',
          result: { skipped: true, reason: 'token budget' },
          timestamp: new Date().toISOString(),
          duration: 0,
          status: 'completed' as const
        }
        workflow.push(skippedStep)
        emitWorkflowUpdate?.()
        emitStepEvent({
          agent: 'Expansion',
          action: 'Generate related questions',
          status: 'degraded',
          stepIndex: workflow.length - 1,
          duration: Date.now() - stepStart,
          failureReason: 'Budget guard: insufficient tokens'
        })
        expansion = {
          originalQuery: query,
          suggestedQuestions: [],
          documentTopics: [],
          expansionStrategy:
            documents.length > 0 ? 'document-based' : 'hybrid',
          cached: false
        }
        recordPhaseTime(context, 'expansion', 0)
        context.expansion = expansion
      } else {
        const expansionStart = Date.now()
        expansion = await this.executeStep(
          workflow,
          'Expansion',
          'Generate related questions',
          () =>
            this.expansionAgent.expandQuery(
              query,
              documents,
              allSources,
              kb
            ), // Pass KB
          emitWorkflowUpdate,
          emitStepEvent
        )
        const expansionDuration = Date.now() - expansionStart
        recordPhaseTime(context, 'expansion', expansionDuration)
        context.expansion = expansion
      }

      const totalDuration = Date.now() - startTime

      // Generate execution summary from context
      const executionSummary = getExecutionSummary(context)

      const result: AgenticRAGResult = {
        response,
        sources: allSources,
        classification,
        workflow,
        totalDuration,
        azureFallback,
        executionSummary,
        ...(routing ? { routing } : {}),
        ...(plan ? { plan } : {}),
        ...(validation ? { validation } : {}),
        ...(refinement ? { refinement } : {}),
        ...(expansion ? { expansion } : {})
      }

      // Log to query history (async, don't block return)
      const namespaceId = azureServiceManager.getNamespaceId()
      const historyPayload: QueryHistoryEntry = {
        id: runId,
        timestamp: new Date().toISOString(),
        query,
        routing: routing
          ? {
              strategy: routing.strategy,
              reasoning: routing.reasoning,
              confidence: routing.confidence
            }
          : {
              strategy: 'hybrid',
              reasoning: 'Query decomposed into sub-queries',
              confidence: 1.0
            },
        resultCount: allSources.length,
        topScore: allSources[0]?.relevanceScore ?? 0,
        azureUsed: azureServiceManager.isConfigured(),
        azureFallback,
        totalDuration,
        retrievalDuration: retrievalDurationMs,
        retrievalAvgScore:
          allSources.length > 0
            ? allSources.reduce((sum, source) => sum + source.relevanceScore, 0) /
              allSources.length
            : 0,
        workflow: workflow.map(step => ({
          agent: step.agent,
          action: step.action,
          duration: step.duration || 0,
          status: step.status
        })),
        complexity: classification.complexity,
        requiresDecomposition: classification.requiresDecomposition,
        executionSummary
      }

      if (validation) {
        historyPayload.validation = {
          faithfulnessScore: validation.faithfulnessScore,
          relevanceScore: validation.relevanceScore,
          isValid: validation.isValid
        }
      }
      if (namespaceId) {
        historyPayload.namespace = namespaceId
      }
      if (context.retrievalMetadata?.storeType) {
        historyPayload.storeType = context.retrievalMetadata.storeType
      }
      if (context.retrievalMetadata?.driftDetected !== undefined) {
        historyPayload.driftDetected = context.retrievalMetadata.driftDetected
      }
      if (context.retrievalMetadata?.driftReasons) {
        historyPayload.driftReasons = context.retrievalMetadata.driftReasons
      }

      queryHistoryService
        .add(historyPayload)
        .catch(error => {
          console.error(
            'Failed to log query to history:',
            error
          )
        })

      return result
    } finally {
      // Ensure active context is cleared to avoid cross-run leakage
      setActiveQueryContext(null)
    }
  }
  private async executeStep<T>(
    workflow: AgentWorkflowStep[],
    agent: string,
    action: string,
    fn: () => Promise<T>,
    emitWorkflowUpdate?: () => void,
    emitStepEvent?: (
      event: Omit<AgentStepEvent, 'type' | 'runId' | 'query' | 'timestamp'> & {
        timestamp?: string
        result?: T
        metadata?: AgentStepMetadata
      }
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

    // Snapshot LLM call count before this step executes so we can detect
    // whether this step actually triggered LLM activity.
    const ctxBefore = getActiveQueryContext?.() || null
    const llmCallsBefore = Array.isArray(ctxBefore?.llmCalls)
      ? ctxBefore.llmCalls.length
      : 0

    // "running" event: do NOT attach llm metadata yet; no LLM call has occurred.
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

      // Detect if this step produced any new LLM calls.
      const ctxAfter = getActiveQueryContext?.() || null
      const llmCallsAfter = Array.isArray(ctxAfter?.llmCalls)
        ? ctxAfter.llmCalls.length
        : llmCallsBefore

      const hasNewLLMCall = llmCallsAfter > llmCallsBefore

      // Only attach llm metadata when this step actually triggered a new LLM call.
      // Pull from the newest entry in ctxAfter.llmCalls to ensure correctness even when
      // Azure is used directly (which doesn't update llmService but does update context).
      let llm: import('../services/telemetry').LLMMetadata | undefined
      if (hasNewLLMCall && ctxAfter?.llmCalls) {
        const lastCall = ctxAfter.llmCalls[llmCallsAfter - 1]
        if (lastCall) {
          llm = {
            model: lastCall.model,
            provider: lastCall.provider,
            promptTokens: lastCall.promptTokens,
            completionTokens: lastCall.completionTokens,
            totalTokens: lastCall.totalTokens,
            estimatedCost: lastCall.estimatedCost,
            ...(lastCall.temperature !== undefined ? { temperature: lastCall.temperature } : {}),
            ...(lastCall.maxTokens !== undefined ? { maxTokens: lastCall.maxTokens } : {})
          }
        }
      }

      emitStepEvent?.({
        agent,
        action,
        status: 'completed',
        stepIndex,
        duration,
        result, // Pass result for metadata extraction in caller
        ...(llm ? { llm } : {})
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

      // Same LLM attribution rule on failure: only if new calls occurred during this step.
      const ctxAfter = getActiveQueryContext?.() || null
      const llmCallsAfter = Array.isArray(ctxAfter?.llmCalls)
        ? ctxAfter.llmCalls.length
        : llmCallsBefore
      const hasNewLLMCall = llmCallsAfter > llmCallsBefore

      // Mirror success-path attribution: derive from ctxAfter.llmCalls so Azure-direct calls
      // (which only update the active context) are visible on failures.
      let llm: import('../services/telemetry').LLMMetadata | undefined
      if (hasNewLLMCall && ctxAfter?.llmCalls) {
        const lastCall = ctxAfter.llmCalls[llmCallsAfter - 1]
        if (lastCall) {
          llm = {
            model: lastCall.model,
            provider: lastCall.provider,
            promptTokens: lastCall.promptTokens,
            completionTokens: lastCall.completionTokens,
            totalTokens: lastCall.totalTokens,
            estimatedCost: lastCall.estimatedCost,
            ...(lastCall.temperature !== undefined ? { temperature: lastCall.temperature } : {}),
            ...(lastCall.maxTokens !== undefined ? { maxTokens: lastCall.maxTokens } : {})
          }
        }
      }

      emitStepEvent?.({
        agent,
        action,
        status: 'failed',
        stepIndex,
        duration,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        ...(llm ? { llm } : {})
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
    onAzureFallback?: () => void,
    kb?: import('./agent-context').KBContext
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
                () => this.routingAgent.selectStrategy(sq.query, kb), // Pass KB
                emitWorkflowUpdate,
                emitStepEvent
              )

	              return findRelevantChunks(
	                sq.query,
	                documents,
	                3,
	                routingDecision.strategy,
	                onAzureFallback ? { onAzureFallback } : undefined
	              )
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
          () => this.routingAgent.selectStrategy(sq.query, kb), // Pass KB
          emitWorkflowUpdate,
          emitStepEvent
        )

        const sources = await this.executeStep(
          workflow,
          'Retrieval',
          `Execute sub-query: ${sq.query.substring(0, 40)}...`,
	          () =>
	            findRelevantChunks(
	              sq.query,
	              documents,
	              3,
	              routingDecision.strategy,
	              onAzureFallback ? { onAzureFallback } : undefined
	            ),
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
      const namespaceId = azureServiceManager.getNamespaceId()
      return await findRelevantChunks(query, documents, 5, strategy, {
        ...(onAzureFallback ? { onAzureFallback } : {}),
        ...(namespaceId ? { namespaceId } : {})
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

      const namespaceId = azureServiceManager.getNamespaceId()
      return findRelevantChunksLocal(query, documents, 5, strategy, namespaceId ? { namespaceId } : undefined)
    }
  }

  // Ensure active query context is cleared when processing completes
  // (callers of processQuery should manage errors; this utility is context-agnostic)

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

  // --- Document Analysis State Machine (Layer 4) ---
  async processDocumentAnalysis(
    runId: string,
    docSlug: string,
    fileName: string,
    contentSample: string
  ): Promise<ChunkingDecision> {
    const start = Date.now()
    const id = runId || this.generateRunId()
    const TTL_7_DAYS = 7 * 24 * 60 * 1000
    const normalizedName = normalizeFileNameForAnalysis(fileName)
    const cacheKey = `doc-analysis:${normalizedName}`
    const contentHash = await computeContentHashForAnalysis(contentSample)

    let state: DocAnalysisState = 'INIT'
    let decision: ChunkingDecision | null = null

    try {
      await healthProgressAgent.heartbeat(id, 'init')
      await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 0, phase: 'init', updatedAt: new Date().toISOString() })
      state = 'CHECK_CANCELLED'

      if (await healthProgressAgent.isCancelled(id)) {
        await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 100, phase: 'complete', updatedAt: new Date().toISOString(), message: 'cancelled' })
        this.logDocAnalysis('DOC_ANALYSIS_CANCELLED', { runId: id, docSlug })
        return { strategy: 'semantic', chunkSize: 1000, overlap: 100, reasoning: 'Cancelled: returning safe default' }
      }

      state = 'CHECK_CACHE'
      const cached = await cacheManager.get<ChunkingDecision>(cacheKey)
      if (cached) {
        await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 100, phase: 'complete', updatedAt: new Date().toISOString() })
        this.logDocAnalysis('doc_analysis_cache_hit', { runId: id, docSlug })
        return cached
      }
      this.logDocAnalysis('doc_analysis_cache_miss', { runId: id, docSlug })
      await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 10, phase: 'analyzing', updatedAt: new Date().toISOString() })

      state = 'LLM_ANALYZE'
      const agentRes = await this.docAnalyzer.analyzeDocumentResult(fileName, contentSample)
      if (agentRes.ok) {
        decision = agentRes.value
      } else {
        this.logDocAnalysis('LLM_JSON_PARSE_FAIL', { runId: id, docSlug, code: agentRes.error.code })
        decision = { strategy: 'semantic', chunkSize: 1000, overlap: 100, reasoning: 'Conservative default (unrecoverable error)' }
      }

      state = 'CACHE_WRITE'
      await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 90, phase: 'caching', updatedAt: new Date().toISOString() })
      try {
        await cacheManager.setWithSemanticHash(cacheKey, decision!, contentHash, TTL_7_DAYS)
      } catch (err) {
        console.warn('[doc-analysis] KV_WRITE_FAIL', { runId: id, docSlug, error: (err as Error)?.message })
      }

      state = 'COMPLETE'
      await healthProgressAgent.heartbeat(id, 'complete')
      await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 100, phase: 'complete', updatedAt: new Date().toISOString() })
      this.logDocAnalysis('doc_analysis_complete', { runId: id, docSlug, ms: Date.now() - start })
      return decision!
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[doc-analysis] ERROR', { runId: id, docSlug, state, error: errorMessage })
      await healthProgressAgent.setProgress({ runId: id, docSlug, percent: 100, phase: 'error', updatedAt: new Date().toISOString(), message: 'error' }).catch(() => void 0)
      return { strategy: 'semantic', chunkSize: 1000, overlap: 100, reasoning: 'Conservative default (runtime error)' }
    }
  }

  private logDocAnalysis(event: string, meta?: Record<string, unknown>): void {
    try { console.info(JSON.stringify({ level: 'info', event, ...meta })) } catch { /* noop */ }
  }

  private generateRunId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `run-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  }
}

// --- Document analysis orchestration (Layer 4 state machine) ---
export interface ProcessDocumentAnalysisOptions {
  runId?: string
}

type DocAnalysisState =
  | 'INIT'
  | 'CHECK_CANCELLED'
  | 'CHECK_CACHE'
  | 'LLM_ANALYZE'
  | 'JSON_REPAIR'
  | 'FALLBACK_ANALYZE'
  | 'CACHE_WRITE'
  | 'COMPLETE'
  | 'ERROR'

function normalizeFileNameForAnalysis(fileName: string): string {
  return fileName.toLowerCase().replace(/\s+-\s+copy(\.\w+)?$/i, '$1')
}

async function computeContentHashForAnalysis(content: string): Promise<string> {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i)
      hash |= 0
    }
    return hash.toString(16)
  }
}

// (removed duplicate class definition here; method attached to primary class below)
