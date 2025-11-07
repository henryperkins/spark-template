import { describe, it, expect } from 'vitest'
import {
  buildKBContext,
  createQueryExecutionContext,
  recordLLMCall,
  calculateCost,
  getExecutionSummary,
  recordPhaseTime
} from '../src/lib/agents/agent-context'
import type { Document } from '../src/types'

describe('KB Context & Budget Tracking', () => {
  it('buildKBContext detects code-heavy KB', () => {
    const docs: Document[] = [
      {
        id: 'doc-1',
        name: 'code-sample.js',
        size: 12,
        uploadedAt: new Date().toISOString(),
        type: 'text/plain',
        processed: true,
        processingStatus: 'completed',
        chunks: [
          { id: 'c1', documentId: 'doc-1', chunkIndex: 0, content: 'function foo() { return 42 }' }
        ],
        source: 'upload'
      }
    ]
    const kb = buildKBContext(docs)
    expect(kb.contentTypes.code).toBeGreaterThan(0.5)
    expect(kb.documentCount).toBe(1)
  })

  it('recordLLMCall updates token budget and execution summary', () => {
    const docs: Document[] = [
      {
        id: 'd',
        name: 'text.txt',
        size: 4,
        uploadedAt: new Date().toISOString(),
        type: 'text/plain',
        processed: true,
        processingStatus: 'completed',
        chunks: [{ id: 'c', documentId: 'd', chunkIndex: 0, content: 'hello world' }],
        source: 'upload'
      }
    ]
    const kb = buildKBContext(docs)
    const ctx = createQueryExecutionContext('run-1', 'query', kb, { tokenBudget: 50000 })
    // Simulate a phase to ensure timings show up in summary
    recordPhaseTime(ctx, 'classification', 120)

    const model = 'gpt-4o-mini'
    const promptTokens = 100
    const completionTokens = 50
    const cost = calculateCost(model, promptTokens, completionTokens)
    recordLLMCall(ctx, {
      model,
      provider: 'worker',
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: cost,
      duration: 42
    })

    const summary = getExecutionSummary(ctx)
    expect(summary.totalTokens).toBeGreaterThan(0)
    expect(summary.llmCallCount).toBe(1)
    expect(summary.phaseBreakdown.classification).toBe(120)
    expect(ctx.tokenBudget.remaining).toBeLessThan(ctx.tokenBudget.total)
  })
})

