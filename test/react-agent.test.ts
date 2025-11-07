import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReActAgent } from '../src/lib/agents/react-agent'

const mkKB = (code: number, technical: number, embeddingCoverage = 1.0) => ({
  contentTypes: { code, prose: 1 - Math.max(code, technical), technical },
  embeddingCoverage
})

describe('ReActAgent KB-aware iteration + budget', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('caps iterations to 2 for code-heavy KB', async () => {
    const agent = new ReActAgent()
    // Always report issues to force iterations until cap
    // @ts-expect-error runtime patch for testing
    agent.criticAgent.validateResponse = vi.fn().mockResolvedValue({
      isValid: false,
      confidence: 0.5,
      issues: ['issue1', 'issue2'],
      suggestions: [],
      faithfulnessScore: 0.4,
      relevanceScore: 0.5,
    })

    const res = await agent.refineResponse(
      'q',
      'r0',
      [],
      ['issue1', 'issue2'],
      { remainingTokenBudget: 10000, minTokensPerIteration: 500 },
      mkKB(0.8, 0.1, 1.0)
    )
    expect(res.iterations).toBeLessThanOrEqual(2)
  })

  it('caps iterations to 1 for low embedding coverage', async () => {
    const agent = new ReActAgent()
    // @ts-expect-error runtime patch for testing
    agent.criticAgent.validateResponse = vi.fn().mockResolvedValue({
      isValid: false,
      confidence: 0.5,
      issues: ['issue'],
      suggestions: [],
      faithfulnessScore: 0.4,
      relevanceScore: 0.5,
    })

    const res = await agent.refineResponse(
      'q',
      'r0',
      [],
      ['issue'],
      { remainingTokenBudget: 10000, minTokensPerIteration: 500 },
      mkKB(0.2, 0.2, 0.2) // low embedding coverage
    )
    expect(res.iterations).toBeLessThanOrEqual(1)
  })

  it('skips refinement when budget is zero', async () => {
    const agent = new ReActAgent()
    // Should not call validator because it will early exit
    // @ts-expect-error runtime patch for testing
    agent.criticAgent.validateResponse = vi.fn()

    const res = await agent.refineResponse(
      'q',
      'r0',
      [],
      ['issue'],
      { remainingTokenBudget: 0, minTokensPerIteration: 1000 }
    )
    expect(res.iterations).toBe(0)
    expect(res.improved).toBe(false)
    expect((agent.criticAgent.validateResponse as any).mock.calls.length).toBe(0)
  })
})

