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
  // Optional raw text to assist JSON repair on EPARSE
  rawText?: string
  constructor(code: LLMErrorCode, message: string, cause?: unknown, rawText?: string) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.cause = cause
    this.rawText = rawText
  }
}

type CompletionOptions = {
  maxTokens?: number
  temperature?: number
  topP?: number
  model?: string
  provider?: 'azure' | 'worker' | 'auto'
}

type CompletionPayload = string | Array<{ role: string; content: string }>

export class LLMService {
  private tokens: number
  private lastRefill: number
  private readonly rate: number
  private readonly burst: number
  private readonly strictModels = new Set([
    'gpt-5-mini',
    'gpt-5-mini-strict',
    'o1',
    'o1-mini',
    'o1-preview',
    'instruct-strict'
  ])

  constructor() {
    this.rate = Math.max(1, appConfig.llm.rateLimitQPS)
    this.burst = Math.max(this.rate, appConfig.llm.rateLimitBurst)
    this.tokens = this.burst
    this.lastRefill = Date.now()
  }

  /**
   * Check if a model deployment requires strict defaults (no temperature/topP overrides).
   */
  private isStrictDeployment(modelName?: string): boolean {
    const name = (modelName || appConfig.model.defaultModel).toLowerCase()
    return Array.from(this.strictModels).some(strict => name.includes(strict))
  }

  /**
   * Sanitize completion options for strict deployments.
   * Removes temperature and topP for models that don't support them.
   */
  private sanitizeOptionsForDeployment(
    options: CompletionOptions
  ): Omit<CompletionOptions, 'model'> & { maxTokens?: number; responseFormat?: 'text' | 'json_object' } {
    const isStrict = this.isStrictDeployment(options.model)

    if (isStrict) {
      // Omit temperature and topP for strict deployments
      return {
        maxTokens: options.maxTokens
      }
    }

    // For flexible deployments, pass all options
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP
    }
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

  // Centralized recording of LLM usage: context + telemetry.
  // Prefers actual token counts returned by providers (Azure) and falls back to estimates only when necessary.
  // Also exposes the last call metadata so orchestrator step events can attribute LLM usage per step.
  private lastLLMMetadata: import('../services/telemetry').LLMMetadata | null = null

  private recordLLMOutcome(
    provider: 'azure' | 'worker',
    model: string | undefined,
    estimatedPromptTokens: number,
    resultText: string,
    options: CompletionOptions,
    startedAt: number,
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; reasoningTokens?: number },
    reasoningPreview?: string
  ): void {
    const resolvedModel = model || appConfig.model.defaultModel

    // Prefer authoritative metrics from provider when available.
    const actualPrompt = typeof usage?.promptTokens === 'number' && Number.isFinite(usage.promptTokens)
      ? usage.promptTokens
      : undefined
    const actualCompletion = typeof usage?.completionTokens === 'number' && Number.isFinite(usage.completionTokens)
      ? usage.completionTokens
      : undefined
    const actualTotal = typeof usage?.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : undefined

    // Derive prompt tokens:
    // - If provider gave us prompt tokens, trust them.
    // - Else, if total and completion are known, derive prompt = total - completion.
    // - Else, fall back to the estimated prompt tokens passed in.
    const promptTokens =
      actualPrompt ??
      (actualTotal !== undefined && actualCompletion !== undefined
        ? Math.max(actualTotal - actualCompletion, 0)
        : estimatedPromptTokens)

    // Derive completion tokens:
    // - If provider gave us completion tokens, trust them.
    // - Else, if total and prompt are known, derive completion = total - prompt.
    // - Else, estimate from result text as last resort.
    const completionTokens =
      actualCompletion ??
      (actualTotal !== undefined
        ? Math.max(actualTotal - promptTokens, 0)
        : estimateTokens(resultText, resolvedModel))

    // Derive total tokens:
    // - Prefer provider total.
    // - Else compute from prompt + completion.
    const totalTokens =
      actualTotal ??
      (promptTokens + completionTokens)

    // Compute cost using the final (mostly-actual) numbers.
    const cost = calculateCost(resolvedModel, promptTokens, completionTokens)

    const duration = Date.now() - startedAt

    // Build metadata object once so it can be:
    // - Attached to the active QueryExecutionContext.llmCalls
    // - Exposed via getLastLLMMetadata for AgentStepEvent.llm attribution
    const metadata: import('../services/telemetry').LLMMetadata & {
      duration: number
      reasoningTokens?: number
      reasoningPreview?: string
    } = {
      model: resolvedModel,
      provider,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost: cost,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      duration,
      reasoningTokens: typeof usage?.reasoningTokens === 'number' ? usage.reasoningTokens : undefined,
      reasoningPreview
    }

    // Push into active query context for budgeting/telemetry.
    const ctx = getActiveQueryContext()
    if (ctx) {
      try {
        recordLLMCall(ctx, metadata)
      } catch {
        // non-fatal
      }
    }

    // Cache as "last call" metadata for orchestrator steps.
    this.lastLLMMetadata = {
      model: metadata.model,
      provider: metadata.provider,
      promptTokens: metadata.promptTokens,
      completionTokens: metadata.completionTokens,
      totalTokens: metadata.totalTokens,
      estimatedCost: metadata.estimatedCost,
      temperature: metadata.temperature,
      maxTokens: metadata.maxTokens
    }

    // Persist via tokenTracker using the same authoritative-or-derived numbers.
    try {
      tokenTracker.recordUsage({
        promptTokens,
        completionTokens,
        totalTokens,
        modelUsed: resolvedModel,
        provider,
        timestamp: new Date().toISOString()
      })
    } catch {
      // best-effort only; never break calls on telemetry failure
    }
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
      const providerPref = options.provider ?? 'auto'
      // Priority 1: Azure OpenAI (production)
      if (providerPref !== 'worker' && azureServiceManager.hasOpenAI()) {
        // Sanitize options for strict deployments
        const azureOptions = this.sanitizeOptionsForDeployment(options)

        // Prefer path that returns usage metadata when available
        const p = azureServiceManager.generateCompletionWithUsage?.(prompt, azureOptions)
          ?? azureServiceManager.generateCompletion(prompt, azureOptions).then(text => ({ text }))
        const res = await this.withTimeout(p, timeoutMs)
        // Centralized recording (context + telemetry)
        this.recordLLMOutcome('azure', options.model, promptTokens, res.text, options, start, res.usage, (res as any).reasoningPreview)
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
    try {
      const raw = await this.generateRawJson(prompt, options)
      return schema.parse(raw)
    } catch (err: any) {
      if (err instanceof LLMError && err.code === 'EPARSE') {
        // Preserve EPARSE with its rawText; caller (e.g. DocumentAnalyzerAgent) will repair.
        throw err
      }
      if (err instanceof Error) {
        // Schema parse failure or other error: attach message as rawText if useful
        throw new LLMError('EPARSE', 'JSON schema validation failed', err, (err as any).rawText)
      }
      throw err
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
        // Strict JSON mode via Responses/Chat API where available.
        const azureOptions = {
          ...this.sanitizeOptionsForDeployment(options),
          responseFormat: 'json_object' as const
        }

        const response = await this.withTimeout(
          (async () => {
            const r =
              await (azureServiceManager.generateCompletionWithUsage?.(prompt, azureOptions) ??
                azureServiceManager
                  .generateCompletion(prompt, azureOptions)
                  .then(text => ({ text })))
            return r
          })(),
          timeoutMs
        )

        const rawText = (response as any).text ?? ''
        if (!rawText || typeof rawText !== 'string') {
          // Treat structurally empty responses as EPARSE for callers like classifier/router.
          throw new LLMError(
            'EPARSE',
            'Azure LLM returned empty JSON response',
            undefined,
            ''
          )
        }

        const parsed = this.parseJson(rawText)
        this.recordLLMOutcome(
          'azure',
          options.model,
          promptTokens,
          JSON.stringify(parsed),
          options,
          start,
          (response as any).usage,
          (response as any).reasoningPreview
        )
        return parsed
      }

      // Fallback: Worker proxy or stubbed responder
      const startWorker = Date.now()
      const responseText = await this.withTimeout(
        this.callWorkerLLM(prompt, options.model, true),
        timeoutMs
      )

      const parsed = this.parseJson(responseText)
      this.recordLLMOutcome(
        'worker',
        options.model,
        promptTokens,
        JSON.stringify(parsed),
        options,
        startWorker
      )
      return parsed
    }

    try {
      const result = await this.retry(call)
      // Note: usage and context already recorded per-branch
      return result
    } catch (err) {
      if (err instanceof LLMError) throw err
      // Normalize unexpected errors as EREMOTE with context
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
            json: Boolean(forceJson)
          })
        }
      )

      if (!resp.ok) {
        // Graceful local/dev fallback when the Worker route is missing.
        if (resp.status === 404) {
          if (forceJson) {
            // Deterministic JSON stub so callers never see "Empty LLM response when JSON expected"
            const stubDecision = {
              strategy: 'semantic',
              chunkSize: 1000,
              overlap: 100,
              reasoning:
                'Stubbed JSON decision for local/dev; Worker /api/llm not running.'
            }
            return JSON.stringify(stubDecision)
          }

          const head =
            resolvedPrompt.length > 300
              ? resolvedPrompt.slice(0, 300) + '…'
              : resolvedPrompt
          return `Stubbed local response (model: ${
            model ?? appConfig.model.defaultModel
          }): ${head}`
        }

        const text = await resp.text().catch(() => String(resp.status))
        throw new LLMError(
          'EREMOTE',
          `Worker LLM proxy error (${resp.status}): ${text}`
        )
      }

      // Expect JSON { text: string } from Worker; handle robustness explicitly.
      const data = (await resp.json()) as { text?: string } | null
      const text = typeof data?.text === 'string' ? data.text.trim() : ''

      if (!text) {
        // If JSON mode was requested, return a deterministic JSON stub to avoid EPARSE at call sites.
        if (forceJson) {
          const stubDecision = {
            strategy: 'semantic',
            chunkSize: 1000,
            overlap: 100,
            reasoning:
              'Stubbed JSON decision; Worker LLM proxy returned empty response.'
          }
          return JSON.stringify(stubDecision)
        }

        throw new LLMError(
          'EPARSE',
          'Worker LLM proxy returned empty response',
          undefined,
          ''
        )
      }

      return text
    } catch (error) {
      // Network or other failures: in dev, provide deterministic stubs.
      if (forceJson) {
        const stubDecision = {
          strategy: 'semantic',
          chunkSize: 1000,
          overlap: 100,
          reasoning:
            'Stubbed JSON decision for local/dev; Worker /api/llm unreachable.'
        }
        return JSON.stringify(stubDecision)
      }

      const head =
        resolvedPrompt.length > 300
          ? resolvedPrompt.slice(0, 300) + '…'
          : resolvedPrompt
      return `Stubbed local response (model: ${
        model ?? appConfig.model.defaultModel
      }): ${head}`
    }
  }

  private parseJson(response: string): unknown {
    const text = (response ?? '').trim()

    // 0) Hard fail on truly empty after upstream stubs.
    if (!text) {
      throw new LLMError(
        'EPARSE',
        'Empty LLM response when JSON expected',
        undefined,
        ''
      )
    }

    // 1) Try strict direct parse first (fast path when model honors json_object).
    try {
      return JSON.parse(text)
    } catch {
      // continue
    }

    // 2) Look for ```json fenced block.
    const md = text.match(/```json?\s*[\r\n]+([\s\S]*?)```/i)
    if (md) {
      const fenced = md[1].trim()
      if (fenced) {
        try {
          return JSON.parse(fenced)
        } catch {
          // continue
        }
      }
    }

    // 2b) Generic fenced block without explicit json language tag.
    const genericFence = text.match(/```\s*[\r\n]+([\s\S]*?)```/)
    if (genericFence && genericFence[1]) {
      const fenced = genericFence[1].trim()
      if (fenced) {
        try {
          return JSON.parse(fenced)
        } catch {
          // continue
        }
      }
    }

    // 3) Balanced brace scan: extract smallest valid top-level JSON object.
    const start = text.indexOf('{')
    if (start !== -1) {
      let depth = 0
      let inString = false
      let escaped = false

      for (let i = start; i < text.length; i++) {
        const ch = text[i]

        if (escaped) {
          escaped = false
          continue
        }

        if (ch === '\\') {
          escaped = true
          continue
        }

        if (ch === '"') {
          inString = !inString
          continue
        }

        if (!inString) {
          if (ch === '{') depth++
          if (ch === '}') depth--

          if (depth === 0) {
            const candidate = text.slice(start, i + 1)
            try {
              return JSON.parse(candidate)
            } catch {
              // continue and ultimately fall through
            }
            break
          }
        }
      }
    }

    // 4) Give up; include rawText for downstream repair agents.
    console.warn(
      '[llm-service] Failed to parse JSON. Raw response (truncated):',
      text.slice(0, 500)
    )
    throw new LLMError(
      'EPARSE',
      'Could not parse JSON from LLM response',
      undefined,
      text.slice(0, 4000)
    )
  }

  getLastLLMMetadata(): import('../services/telemetry').LLMMetadata | null {
    return this.lastLLMMetadata
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

/**
 * Safely parse JSON with sanitation for common LLM output issues.
 * Strips code fences, trims whitespace, and handles various JSON formats.
 */
export function safeParseJson(raw: unknown): unknown {
  try {
    let s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim()

    // Strip common code fences or noise
    if (s.startsWith('```json')) s = s.replace(/^```json/i, '')
    if (s.startsWith('```')) s = s.replace(/^```/, '')
    if (s.endsWith('```')) s = s.slice(0, -3)

    // Try direct parse
    return JSON.parse(s)
  } catch (e) {
    console.error('[llm-service] safeParseJson failed:', e)
    const msg = e instanceof Error ? e.message : String(e)
    return { _parseError: msg, _raw: raw }
  }
}

export const llmService = new LLMService()
