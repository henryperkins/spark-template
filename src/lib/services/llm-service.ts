import { ZodSchema } from 'zod'
import { azureServiceManager } from '../azure-service-manager'
import { appConfig } from '../config'
import { estimateTokens } from '../prompt-utils'
import { tokenTracker } from './token-tracker'
import { getActiveQueryContext } from '../agents/context-registry'
import { recordLLMCall, calculateCost } from '../agents/agent-context'

export type LLMErrorCode = 'ETIMEDOUT' | 'ERATELIMIT' | 'EPARSE' | 'EREMOTE'

export class LLMError extends Error {
  code: LLMErrorCode
  cause?: unknown
  constructor(code: LLMErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.cause = cause
  }
}

type CompletionOptions = {
  maxTokens?: number
  temperature?: number
  topP?: number
  model?: string
}

type CompletionPayload = string | Array<{ role: string; content: string }>

export class LLMService {
  private tokens: number
  private lastRefill: number
  private readonly rate: number
  private readonly burst: number

  constructor() {
    this.rate = Math.max(1, appConfig.llm.rateLimitQPS)
    this.burst = Math.max(this.rate, appConfig.llm.rateLimitBurst)
    this.tokens = this.burst
    this.lastRefill = Date.now()
  }

  private refillTokens(): void {
    const now = Date.now()
    const delta = (now - this.lastRefill) / 1000
    if (delta > 0) {
      this.tokens = Math.min(this.burst, this.tokens + delta * this.rate)
      this.lastRefill = now
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms))
  }

  // Centralized recording of LLM usage: context + telemetry
  private recordLLMOutcome(
    provider: 'azure' | 'worker',
    model: string | undefined,
    promptTokens: number,
    resultText: string,
    options: CompletionOptions,
    startedAt: number,
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  ): void {
    const resolvedModel = model || appConfig.model.defaultModel
    const measuredPrompt = usage?.promptTokens
    const measuredCompletion = usage?.completionTokens
    const measuredTotal = usage?.totalTokens
    const completionTokens = typeof measuredCompletion === 'number'
      ? measuredCompletion
      : estimateTokens(resultText, resolvedModel)
    const effectivePrompt = typeof measuredPrompt === 'number' ? measuredPrompt : promptTokens
    const effectiveTotal = typeof measuredTotal === 'number' ? measuredTotal : effectivePrompt + completionTokens
    const cost = calculateCost(resolvedModel, effectivePrompt, effectiveTotal - effectivePrompt)

    const ctx = getActiveQueryContext()
    if (ctx) {
      try {
        recordLLMCall(ctx, {
          model: resolvedModel,
          provider,
          promptTokens: effectivePrompt,
          completionTokens,
          totalTokens: effectiveTotal,
          estimatedCost: cost,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          duration: Date.now() - startedAt
        })
      } catch { /* non-fatal */ }
    }

    try {
      tokenTracker.recordUsage({
        promptTokens: effectivePrompt,
        completionTokens,
        totalTokens: effectiveTotal,
        modelUsed: resolvedModel,
        provider,
        timestamp: new Date().toISOString()
      })
    } catch { /* best-effort */ }
  }

  private async acquireToken(): Promise<void> {
    // simple token bucket
    for (;;) {
      this.refillTokens()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const deficit = 1 - this.tokens
      const waitMs = Math.ceil((deficit / this.rate) * 1000)
      await this.sleep(Math.max(10, waitMs))
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new LLMError('ETIMEDOUT', `LLM request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    try {
      const result = await Promise.race([promise, timeoutPromise])
      return result as T
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = Math.max(0, appConfig.llm.maxRetries)
    const backoffBase = Math.max(50, appConfig.llm.retryBackoffMs)
    let lastErr: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (attempt === maxRetries) break
        const jitter = 0.8 + Math.random() * 0.4
        const delay = Math.min(5000, backoffBase * Math.pow(2, attempt) * jitter)
        await this.sleep(delay)
      }
    }
    if (lastErr instanceof LLMError) throw lastErr
    throw new LLMError('EREMOTE', 'LLM request failed after retries', lastErr)
  }

  async generateText(
    prompt: CompletionPayload,
    options: CompletionOptions = {}
  ): Promise<string> {
    await this.acquireToken()
    const timeoutMs = Math.max(1000, appConfig.llm.timeoutMs)
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(m => m.content).join('\n')
    const promptTokens = estimateTokens(promptText, options.model || appConfig.model.defaultModel)

    const call = async () => {
      const start = Date.now()
      // Priority 1: Azure OpenAI (production)
      if (azureServiceManager.hasOpenAI()) {
        // Prefer path that returns usage metadata when available
        const p = azureServiceManager.generateCompletionWithUsage?.(prompt, {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          topP: options.topP
        }) ?? azureServiceManager.generateCompletion(prompt, {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          topP: options.topP
        }).then(text => ({ text }))
        const res = await this.withTimeout(p, timeoutMs)
        // Centralized recording (context + telemetry)
        this.recordLLMOutcome('azure', options.model, promptTokens, res.text, options, start, res.usage)
        return res.text
      }

      // Priority 2: Fallback to Worker proxy (or stubbed responder)
      const startWorker = Date.now()
      const p = this.callWorkerLLM(prompt, options.model, false)
      const res = await this.withTimeout(p, timeoutMs)
      this.recordLLMOutcome('worker', options.model, promptTokens, res, options, startWorker)
      return res
    }
    try {
      const result = await this.retry(call)
      // Note: usage and context already recorded per-branch
      return result
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw new LLMError('EREMOTE', 'generateText failed', err)
    }
  }

  async generateJson<T>(
    prompt: CompletionPayload,
    schema: ZodSchema<T>,
    options: CompletionOptions = {}
  ): Promise<T> {
    const raw = await this.generateRawJson(prompt, options)
    try {
      return schema.parse(raw)
    } catch (error) {
      throw new LLMError('EPARSE', 'JSON schema validation failed', error)
    }
  }

  private trackTokenUsage(
    promptTokens: number,
    completionTokens: number,
    model: string,
    provider: 'azure' | 'worker'
  ): void {
    tokenTracker.recordUsage({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      modelUsed: model,
      provider,
      timestamp: new Date().toISOString()
    })
  }

  private async generateRawJson(
    prompt: CompletionPayload,
    options: CompletionOptions
  ): Promise<unknown> {
    await this.acquireToken()
    const timeoutMs = Math.max(1000, appConfig.llm.timeoutMs)
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(m => m.content).join('\n')
    const promptTokens = estimateTokens(promptText, options.model || appConfig.model.defaultModel)

    const call = async () => {
      const start = Date.now()
      if (azureServiceManager.hasOpenAI()) {
        const response = await this.withTimeout(
          (async () => {
            const r = await (azureServiceManager.generateCompletionWithUsage?.(prompt, {
              maxTokens: options.maxTokens,
              temperature: options.temperature,
              topP: options.topP,
              responseFormat: 'json_object'
            }) ?? azureServiceManager.generateCompletion(prompt, {
              maxTokens: options.maxTokens,
              temperature: options.temperature,
              topP: options.topP,
              responseFormat: 'json_object'
            }).then(text => ({ text })))
            return r
          })(),
          timeoutMs
        )
        const parsed = this.parseJson(response.text)
        this.recordLLMOutcome('azure', options.model, promptTokens, JSON.stringify(parsed), options, start, response.usage)
        return parsed
      } else {
        const startWorker = Date.now()
        const response = await this.withTimeout(
          this.callWorkerLLM(prompt, options.model, true),
          timeoutMs
        )
        const parsed = this.parseJson(response)
        this.recordLLMOutcome('worker', options.model, promptTokens, JSON.stringify(parsed), options, startWorker)
        return parsed
      }
    }
    try {
      const result = await this.retry(call)
      // Note: usage and context already recorded per-branch
      return result
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw new LLMError('EREMOTE', 'generateRawJson failed', err)
    }
  }

  private async callWorkerLLM(
    prompt: CompletionPayload,
    model?: string,
    forceJson?: boolean
  ): Promise<string> {
    const resolvedPrompt =
      typeof prompt === 'string'
        ? prompt
        : prompt.map(message => message.content).join('\n')

    try {
      const resp = await fetch(
        (import.meta as any)?.env?.VITE_LLM_ENDPOINT || '/api/llm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: resolvedPrompt,
            model: model ?? appConfig.model.defaultModel,
            json: Boolean(forceJson),
          }),
        }
      )
      if (!resp.ok) {
        // Graceful local fallback: if the route doesn't exist (e.g., Vite dev without Worker),
        // return a deterministic stub instead of throwing.
        if (resp.status === 404) {
          if (forceJson) {
            const stub = {
              summary: resolvedPrompt.slice(0, 120),
              note: 'Local dev stub (Worker /api/llm not running)',
              model: model ?? appConfig.model.defaultModel,
            }
            return JSON.stringify(stub)
          }
          const head = resolvedPrompt.length > 300 ? resolvedPrompt.slice(0, 300) + '…' : resolvedPrompt
          return `Stubbed local response (model: ${model ?? appConfig.model.defaultModel}): ${head}`
        }
        const text = await resp.text().catch(() => String(resp.status))
        throw new LLMError('EREMOTE', `Worker LLM proxy error (${resp.status}): ${text}`)
      }
      const data = (await resp.json()) as { text?: string }
      if (!data?.text) {
        throw new LLMError('EPARSE', 'Worker LLM proxy returned empty response')
      }
      return data.text
    } catch (error) {
      // Network or other failures: in dev, provide a deterministic stub
      if (forceJson) {
        const stub = {
          summary: resolvedPrompt.slice(0, 120),
          note: 'Local dev stub (Worker /api/llm unreachable)',
          model: model ?? appConfig.model.defaultModel,
        }
        return JSON.stringify(stub)
      }
      const head = resolvedPrompt.length > 300 ? resolvedPrompt.slice(0, 300) + '…' : resolvedPrompt
      return `Stubbed local response (model: ${model ?? appConfig.model.defaultModel}): ${head}`
    }
  }

  private parseJson(response: string): unknown {
    const text = (response ?? '').trim()

    // 1) Try direct parse
    try {
      return JSON.parse(text)
    } catch { /* ignore parse error */ }

    // 2) Try fenced markdown ```json ... ```
    const md = text.match(/```json?\s*\n([\s\S]*?)\n```/i)
    if (md) {
      try {
        return JSON.parse(md[1])
      } catch { /* ignore parse error */ }
    }

    // 3) Try first JSON object substring
    const objectMatch = text.match(/\{[\s\S]*\}/)
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0])
      } catch { /* ignore parse error */ }
    }

    // 4) Give up with diagnostic
    throw new LLMError('EPARSE', `Could not parse JSON from LLM response: ${text.slice(0, 200)}`)
  }

  async *generateTextStream(
    prompt: CompletionPayload,
    options: CompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    if (!appConfig.llm.enableStreaming) {
      yield await this.generateText(prompt, options)
      return
    }

    await this.acquireToken()
    const timeoutMs = Math.max(1000, appConfig.llm.timeoutMs)
    const promptText = typeof prompt === 'string' ? prompt : prompt.map(m => m.content).join('\n')
    const promptTokens = estimateTokens(promptText, options.model || appConfig.model.defaultModel)

    try {
      if (azureServiceManager.hasOpenAI()) {
        const start = Date.now()
        const stream = azureServiceManager.generateStream(prompt, {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          topP: options.topP
        })
        let collected = ''
        for await (const chunk of stream) {
          // basic timeout guard by chunk pacing
          if (typeof chunk === 'string' && chunk.length > 0) {
            collected += chunk
            yield chunk
          }
        }
        // After streaming completes, record usage
        this.recordLLMOutcome('azure', options.model, promptTokens, collected, options, start)
      } else {
        // Fallback to single chunk
        yield await this.withTimeout(this.generateText(prompt, options), timeoutMs)
      }
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw new LLMError('EREMOTE', 'generateTextStream failed', err)
    }
  }
}

export const llmService = new LLMService()
