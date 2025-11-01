import { Document, Source } from '@/types'
import { QueryClassifierAgent, QueryClassification } from './query-classifier'
import { QueryPlannerAgent, QueryPlan } from './query-planner'
import { RoutingAgent, RoutingDecision } from './routing-agent'
import { CriticAgent, ValidationResult } from './critic-agent'
import { ReActAgent, ReActResult } from './react-agent'
import { QueryExpansionAgent, QueryExpansion } from './query-expansion'
import { findRelevantChunks, generateResponse } from '../rag'
import { azureServiceManager } from '../azure-service-manager'

export interface AgentWorkflowStep {
  agent: string
  action: string
  result: any
  timestamp: string
  duration?: number
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
    documents: Document[]
  ): Promise<AgenticRAGResult> {
    const startTime = Date.now()
    const workflow: AgentWorkflowStep[] = []

    const classification = await this.executeStep(
      workflow,
      'Classifier',
      'Classify query complexity',
      () => this.classifierAgent.classifyQuery(query)
    )

    let allSources: Source[] = []
    let plan: QueryPlan | undefined
    let routing: RoutingDecision | undefined

    if (classification.requiresDecomposition) {
      plan = await this.executeStep(
        workflow,
        'Planner',
        'Create query plan',
        () => this.plannerAgent.createPlan(query, classification.estimatedSubQueries)
      )

      allSources = await this.executeSubQueries(plan, documents, workflow)
    } else {
      routing = await this.executeStep(
        workflow,
        'Router',
        'Select retrieval strategy',
        () => this.routingAgent.selectStrategy(query)
      )

      allSources = await this.executeStep(
        workflow,
        'Retrieval',
        `Execute ${routing.strategy} search`,
        () => this.executeRetrieval(query, documents, routing!.strategy)
      )
    }

    let response = await this.executeStep(
      workflow,
      'Generator',
      'Generate initial response',
      () => generateResponse(query, allSources)
    )

    const validation = await this.executeStep(
      workflow,
      'Critic',
      'Validate response quality',
      () => this.criticAgent.validateResponse(query, response, allSources)
    )

    let refinement: ReActResult | undefined

    if (!validation.isValid || validation.faithfulnessScore < 0.7) {
      refinement = await this.executeStep(
        workflow,
        'ReAct',
        'Refine response iteratively',
        () => this.reactAgent.refineResponse(
          query,
          response,
          allSources,
          validation.issues
        )
      )

      if (refinement.improved) {
        response = refinement.finalResponse
      }
    }

    const expansion = await this.executeStep(
      workflow,
      'Expansion',
      'Generate related questions',
      () => this.expansionAgent.expandQuery(query, documents, allSources)
    )

    const totalDuration = Date.now() - startTime

    return {
      response,
      sources: allSources,
      classification,
      routing,
      plan,
      validation,
      refinement,
      expansion,
      workflow,
      totalDuration
    }
  }

  private async executeStep<T>(
    workflow: AgentWorkflowStep[],
    agent: string,
    action: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const stepStart = Date.now()
    
    try {
      const result = await fn()
      const duration = Date.now() - stepStart

      workflow.push({
        agent,
        action,
        result,
        timestamp: new Date().toISOString(),
        duration
      })

      return result
    } catch (error) {
      const duration = Date.now() - stepStart
      
      workflow.push({
        agent,
        action: `${action} (failed)`,
        result: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toISOString(),
        duration
      })

      throw error
    }
  }

  private async executeSubQueries(
    plan: QueryPlan,
    documents: Document[],
    workflow: AgentWorkflowStep[]
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
            () => findRelevantChunks(sq.query, documents, 3)
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
        const sources = await this.executeStep(
          workflow,
          'Retrieval',
          `Execute sub-query: ${sq.query.substring(0, 40)}...`,
          () => findRelevantChunks(sq.query, documents, 3)
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
    strategy: 'vector' | 'keyword' | 'hybrid'
  ): Promise<Source[]> {
    if (azureServiceManager.isConfigured()) {
      try {
        const useHybrid = strategy === 'hybrid' || strategy === 'keyword'
        return await azureServiceManager.searchWithAzure(query, useHybrid)
      } catch (error) {
        console.warn('Azure search failed, falling back to local:', error)
      }
    }

    return findRelevantChunks(query, documents, 5)
  }
}
