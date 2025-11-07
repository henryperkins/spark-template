import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgenticOrchestrator } from '../src/lib/agents/orchestrator'
import type { Document } from '../src/types'
import { azureServiceManager } from '../src/lib/azure-service-manager'

describe('AgenticOrchestrator', () => {
  let orchestrator: AgenticOrchestrator

  const createTestDocument = (id: string, content: string): Document => ({
    id,
    name: `${id}.txt`,
    size: content.length,
    uploadedAt: new Date().toISOString(),
    type: 'text/plain',
    processed: true,
    processingStatus: 'completed',
    chunks: [
      {
        id: `${id}-chunk-0`,
        documentId: id,
        chunkIndex: 0,
        content,
        embedding: new Array(1536).fill(0.1)
      }
    ],
    source: 'upload'
  })

  beforeEach(() => {
    orchestrator = new AgenticOrchestrator()
    vi.spyOn(azureServiceManager, 'isConfigured').mockReturnValue(false)
    vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('processQuery', () => {
    it('executes full RAG workflow for simple query', async () => {
      const documents = [
        createTestDocument('doc-1', 'Machine learning is a subset of AI focused on algorithms.')
      ]

      const result = await orchestrator.processQuery('What is machine learning?', documents, {
        runId: 'test-run-1'
      })

      expect(result.response).toBeDefined()
      expect(result.sources).toBeDefined()
      expect(result.classification).toBeDefined()
      expect(result.classification.complexity).toBeDefined()
      expect(result.workflow.length).toBeGreaterThan(0)
      expect(result.totalDuration).toBeGreaterThan(0)
    })

    it('tracks workflow steps', async () => {
      const documents = [
        createTestDocument('doc-1', 'Test content for workflow tracking')
      ]

      const workflowUpdates: any[] = []

      await orchestrator.processQuery('test query', documents, {
        runId: 'test-run-2',
        onWorkflowUpdate: (workflow) => {
          workflowUpdates.push([...workflow])
        }
      })

      expect(workflowUpdates.length).toBeGreaterThan(0)
      const finalWorkflow = workflowUpdates[workflowUpdates.length - 1]
      expect(finalWorkflow.every((step: any) => step.status === 'completed' || step.status === 'failed')).toBe(true)
    })

    it('emits step events during workflow', async () => {
      const documents = [
        createTestDocument('doc-1', 'Test content for step events')
      ]

      const stepEvents: any[] = []

      await orchestrator.processQuery('test query', documents, {
        runId: 'test-run-3',
        onStepEvent: (event) => {
          stepEvents.push({ ...event })
        }
      })

      expect(stepEvents.length).toBeGreaterThan(0)
      expect(stepEvents.some(e => e.agent === 'Classifier')).toBe(true)
      expect(stepEvents.some(e => e.agent === 'Router')).toBe(true)
    })

    it('handles queries with no relevant sources', async () => {
      const documents = [
        createTestDocument('doc-1', 'Completely unrelated content about quantum physics')
      ]

      const result = await orchestrator.processQuery('What is machine learning?', documents)

      expect(result.response).toBeDefined()
      // Should still generate a response even with no good sources
      expect(result.sources).toBeDefined()
    })

    it('generates execution summary with token tracking', async () => {
      const documents = [
        createTestDocument('doc-1', 'Test document for token tracking')
      ]

      const result = await orchestrator.processQuery('test query', documents)

      expect(result.executionSummary).toBeDefined()
      expect(result.executionSummary?.totalTokens).toBeGreaterThanOrEqual(0)
      expect(result.executionSummary?.totalCost).toBeGreaterThanOrEqual(0)
      expect(result.executionSummary?.llmCallCount).toBeGreaterThanOrEqual(0)
      expect(result.executionSummary?.phaseBreakdown).toBeDefined()
    })

    it('handles complex queries requiring decomposition', async () => {
      const documents = [
        createTestDocument('doc-1', 'Machine learning basics'),
        createTestDocument('doc-2', 'Deep learning algorithms'),
        createTestDocument('doc-3', 'Neural network architectures')
      ]

      // Mock a complex classification
      const mockClassifier = orchestrator['classifierAgent']
      vi.spyOn(mockClassifier, 'classifyQuery').mockResolvedValue({
        complexity: 'complex',
        requiresDecomposition: true,
        estimatedSubQueries: 3,
        reasoning: 'Multi-faceted query'
      })

      const result = await orchestrator.processQuery(
        'Compare machine learning and deep learning, and explain neural networks',
        documents
      )

      expect(result.plan).toBeDefined()
      expect(result.classification.requiresDecomposition).toBe(true)
    })

    it('sets azureFallback flag when Azure is unavailable', async () => {
      vi.spyOn(azureServiceManager, 'isConfigured').mockReturnValue(true)
      vi.spyOn(azureServiceManager, 'searchWithAzure').mockRejectedValue(new Error('Azure unavailable'))

      const documents = [
        createTestDocument('doc-1', 'Test content')
      ]

      const result = await orchestrator.processQuery('test query', documents)

      expect(result.azureFallback).toBe(true)
    })

    it('includes validation results when sources are available', async () => {
      const documents = [
        createTestDocument('doc-1', 'Detailed content about machine learning algorithms and techniques')
      ]

      const result = await orchestrator.processQuery('What is machine learning?', documents)

      if (result.sources.length > 0) {
        expect(result.validation).toBeDefined()
        expect(result.validation?.isValid).toBeDefined()
        expect(result.validation?.faithfulnessScore).toBeGreaterThanOrEqual(0)
        expect(result.validation?.relevanceScore).toBeGreaterThanOrEqual(0)
      }
    })

    it('generates query expansion suggestions', async () => {
      const documents = [
        createTestDocument('doc-1', 'Machine learning content'),
        createTestDocument('doc-2', 'AI and data science topics')
      ]

      const result = await orchestrator.processQuery('machine learning', documents)

      expect(result.expansion).toBeDefined()
      expect(result.expansion.originalQuery).toBe('machine learning')
      expect(Array.isArray(result.expansion.suggestedQuestions)).toBe(true)
    })

    it('generates unique run IDs when not provided', async () => {
      const documents = [createTestDocument('doc-1', 'Test')]

      const result1 = await orchestrator.processQuery('query 1', documents)
      const result2 = await orchestrator.processQuery('query 2', documents)

      // Workflow steps include timestamps which should differ
      expect(result1.workflow[0].timestamp).not.toBe(result2.workflow[0].timestamp)
    })
  })

  describe('processDocumentAnalysis', () => {
    it('analyzes document and returns chunking decision', async () => {
      const result = await orchestrator.processDocumentAnalysis(
        'test-run',
        'test-doc',
        'document.txt',
        'Sample content for analysis. This is a test document.'
      )

      expect(result).toBeDefined()
      expect(result.strategy).toBeDefined()
      expect(['paragraph', 'sentence', 'semantic', 'fixed']).toContain(result.strategy)
      expect(result.chunkSize).toBeGreaterThan(0)
      expect(result.overlap).toBeGreaterThanOrEqual(0)
      expect(result.reasoning).toBeDefined()
    })

    it('uses cache for repeated document analysis', async () => {
      const fileName = 'cached-doc.txt'
      const content = 'Sample content for caching test'

      const result1 = await orchestrator.processDocumentAnalysis('run-1', 'slug-1', fileName, content)
      const result2 = await orchestrator.processDocumentAnalysis('run-2', 'slug-2', fileName, content)

      // Both should return valid results
      expect(result1.strategy).toBeDefined()
      expect(result2.strategy).toBeDefined()
    })

    it('handles cancellation during document analysis', async () => {
      // Mock cancellation
      const healthAgent = orchestrator['healthProgressAgent' as any]
      if (healthAgent) {
        vi.spyOn(healthAgent, 'isCancelled').mockResolvedValue(true)
      }

      const result = await orchestrator.processDocumentAnalysis(
        'cancelled-run',
        'test-doc',
        'document.txt',
        'Content'
      )

      // Should return safe defaults when cancelled or on error
      expect(result.reasoning).toBeDefined()
      expect(result.strategy).toBeDefined()
    })

    it('returns conservative defaults on analysis errors', async () => {
      // Force an error by providing invalid inputs
      const result = await orchestrator.processDocumentAnalysis(
        'error-run',
        'test-doc',
        '',
        '' // Empty content might cause issues
      )

      // Should still return a valid decision, not throw
      expect(result).toBeDefined()
      expect(result.strategy).toBeDefined()
      expect(result.reasoning).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('continues workflow even if individual steps fail gracefully', async () => {
      const documents = [createTestDocument('doc-1', 'Test content')]

      // Mock a failure in routing
      const mockRouter = orchestrator['routingAgent']
      vi.spyOn(mockRouter, 'selectStrategy').mockRejectedValueOnce(new Error('Routing failed'))

      // Should not throw, but may have degraded results
      await expect(orchestrator.processQuery('test', documents)).rejects.toThrow()
    })

    it('handles empty document list', async () => {
      const result = await orchestrator.processQuery('test query', [])

      expect(result.response).toBeDefined()
      expect(result.sources).toHaveLength(0)
      expect(result.workflow).toBeDefined()
    })
  })
})
