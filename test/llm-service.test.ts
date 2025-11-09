import { describe, it, expect, vi, afterEach } from 'vitest'
import { llmService, safeParseJson } from '../src/lib/services/llm-service'
import { azureServiceManager } from '../src/lib/azure-service-manager'
import { tokenTracker } from '../src/lib/services/token-tracker'

describe('LLMService integration (usage + errors)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records Azure usage when provided by service', async () => {
    vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)
    const usage = { promptTokens: 120, completionTokens: 60, totalTokens: 180 }
    vi.spyOn(azureServiceManager as any, 'generateCompletionWithUsage').mockResolvedValue({
      text: 'ok',
      usage
    })

    const spy = vi.spyOn(tokenTracker, 'recordUsage').mockResolvedValue()

    const out = await llmService.generateText('Hello world', { model: 'gpt-4o-mini' })
    expect(out).toBe('ok')
    expect(spy).toHaveBeenCalled()

    const lastCall = spy.mock.calls.at(-1)?.[0]
    expect(lastCall).toBeTruthy()
    expect(lastCall?.promptTokens).toBe(usage.promptTokens)
    expect(lastCall?.completionTokens).toBe(usage.completionTokens)
    expect(lastCall?.totalTokens).toBe(usage.totalTokens)
    expect((lastCall?.modelUsed || '').toLowerCase()).toContain('gpt-4o')
    expect(lastCall?.provider).toBe('azure')
  })

  it('throws EPARSE on invalid JSON response path', async () => {
    vi.spyOn(azureServiceManager, 'hasOpenAI').mockReturnValue(true)
    vi.spyOn(azureServiceManager as any, 'generateCompletionWithUsage').mockResolvedValue({
      text: 'not json here',
      usage: { totalTokens: 10 }
    })

    await expect(
      llmService.generateJson('Please return JSON', { parse: () => null } as any, { model: 'gpt-4o-mini' })
    ).rejects.toMatchObject({ code: 'EPARSE' })
  })
})

describe('safeParseJson()', () => {
  it('parses plain JSON string', () => {
    const raw = '{"foo": "bar"}'
    const parsed = safeParseJson(raw) as any
    expect(parsed).toEqual({ foo: 'bar' })
  })

  it('strips ```json fenced block', () => {
    const raw = ['```json', '{ "a": 1 }', '```'].join('\n')
    const parsed = safeParseJson(raw) as any
    expect(parsed).toEqual({ a: 1 })
  })

  it('strips generic ``` fenced block', () => {
    const raw = ['```', '{ "b": 2 }', '```'].join('\n')
    const parsed = safeParseJson(raw) as any
    expect(parsed).toEqual({ b: 2 })
  })

  it('returns diagnostic object on failure', () => {
    const raw = 'not json'
    const parsed = safeParseJson(raw) as any
    expect(parsed).toHaveProperty('_parseError')
    expect(parsed).toHaveProperty('_raw', raw)
  })
})

