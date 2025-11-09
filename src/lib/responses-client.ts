import { AzureConfig } from '@/types'
import { errorTracking } from '@/lib/services/error-tracker'

/**
 * Lightweight client for Azure OpenAI v1 Responses API.
 * Wraps /openai/v1/responses in a project-friendly interface.
 *
 * Endpoint shape (from v1azureAPI.json servers):
 *   {endpoint}/openai/v1
 *
 * Notes:
 * - Non-breaking: only used when wired/enabled by AzureOpenAIService.
 * - Does not depend on the OpenAI SDK; uses fetch directly.
 */

export interface ResponsesClientConfig {
  endpoint: string // e.g. https://<resource>.openai.azure.com
  apiKey?: string
  tokenProvider?: () => Promise<string>
  defaultModel: string
  apiVersion?: string // default: 'v1'
  timeoutMs?: number
  defaultStore?: boolean
  defaultBackground?: boolean
  defaultMaxOutputTokens?: number
  defaultHeaders?: Record<string, string>
}

export type ResponseRole = 'system' | 'developer' | 'user' | 'assistant'

/**
 * Minimal item types we care about for this project.
 * We intentionally keep this narrow and tolerant of unknown fields.
 */
export type ResponseContentItem =
  | {
      type: 'input_text' | 'output_text'
      text: string
    }
  | {
      type: 'input_image'
      image_url: string
    }
  | {
      // generic catch-all to avoid runtime failures if new types appear
      type: string
      [key: string]: unknown
    }

export interface ResponseMessage {
  id?: string
  role: ResponseRole
  content: ResponseContentItem[]
}

export interface ResponsesUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

export interface ResponsesResult {
  id: string
  status: string
  model?: string
  outputText: string
  messages: ResponseMessage[]
  usage?: ResponsesUsage
  raw: any
  reasoningPreview?: string
}

/**
 * Streaming event surface for higher-level services.
 */
export type ResponsesStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'message-complete'; result: ResponsesResult }
  | { type: 'error'; error: Error }

export interface CreateResponseOptions {
  model?: string
  messages: Array<{ role: ResponseRole; content: string | ResponseContentItem[] }>

  // Sampling / behavior
  maxOutputTokens?: number
  temperature?: number
  topP?: number

  // Storage / background
  store?: boolean
  background?: boolean

  // Response chaining and instructions
  previousResponseId?: string
  instructions?: string

  // Reasoning configuration (for o-series models)
  reasoning?: {
    effort?: 'low' | 'medium' | 'high'
  }

  // Tools (function calling, MCP, etc.) - passed through opaquely
  tools?: any[]
  toolChoice?: any

  // Additional raw fields if needed (e.g. metadata, include, etc.)
  extraBody?: Record<string, unknown>

  // Response format control (aligns with v1 text.format helper)
  responseFormat?:
    | { type: 'text' }
    | { type: 'json_object' }
    | {
        type: 'json_schema'
        json_schema: {
          name?: string
          schema?: Record<string, unknown>
          description?: string
          strict?: boolean
          [key: string]: unknown
        }
      }
}

/**
 * Internal helper for building the input array expected by Responses API.
 */
function buildInputItemsFromMessages(
  messages: Array<{ role: ResponseRole; content: string | ResponseContentItem[] }>
): any[] {
  return messages.map(m => {
    const content: ResponseContentItem[] =
      typeof m.content === 'string'
        ? [
            {
              type: 'input_text',
              text: m.content
            }
          ]
        : m.content

    return {
      type: 'message',
      role: m.role,
      content
    }
  })
}

export class ResponsesClient {
  private readonly config: Required<Pick<ResponsesClientConfig, 'endpoint' | 'defaultModel'>> &
    Omit<ResponsesClientConfig, 'endpoint' | 'defaultModel'>

  constructor(cfg: ResponsesClientConfig) {
    const endpoint = cfg.endpoint.replace(/\/+$/, '')
    if (!endpoint) {
      throw new Error('[ResponsesClient] endpoint is required')
    }
    if (!cfg.defaultModel) {
      throw new Error('[ResponsesClient] defaultModel is required')
    }

    this.config = {
      ...cfg,
      endpoint,
      defaultModel: cfg.defaultModel,
      apiVersion: cfg.apiVersion ?? 'v1'
    }
  }

  /**
   * Create a single Responses API call (non-streaming by default).
   */
  async createResponse(options: CreateResponseOptions): Promise<ResponsesResult> {
    const body = await this.buildRequestBody(options, { stream: false })
    const res = await this.fetchWithAuth('/responses', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw await this.buildError(res, body)
    }

    const json = await res.json()
    return this.toResult(json)
  }

  /**
   * Retrieve a previously created response by ID.
   */
  async retrieveResponse(id: string): Promise<ResponsesResult> {
    const res = await this.fetchWithAuth(`/responses/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: this.jsonHeaders()
    })

    if (!res.ok) {
      throw await this.buildError(res)
    }

    const json = await res.json()
    return this.toResult(json)
  }

  /**
   * Delete a stored response.
   * Aligns with delete semantics described in responses docs.
   */
  async deleteResponse(
    id: string
  ): Promise<{ id: string; deleted: boolean; raw: any }> {
    const res = await this.fetchWithAuth(`/responses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.jsonHeaders()
    })

    if (!res.ok) {
      throw await this.buildError(res)
    }

    const json = await res.json().catch(() => ({}))
    const deleted =
      json && typeof json.deleted === 'boolean' ? json.deleted : true
    return {
      id,
      deleted,
      raw: json
    }
  }

  /**
   * Start a background response (store=true, background=true).
   * Call retrieveResponse(...) later to get final result.
   */
  async createBackgroundResponse(
    options: CreateResponseOptions
  ): Promise<{ id: string; status: string; raw: any }> {
    const body = await this.buildRequestBody(
      {
        ...options,
        store: options.store ?? true,
        background: true
      },
      { stream: false }
    )

    const res = await this.fetchWithAuth('/responses', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw await this.buildError(res, body)
    }

    const json = await res.json()
    return {
      id: json.id,
      status: json.status,
      raw: json
    }
  }

  /**
   * Cancel a background response by ID.
   * Returns the final status of the response.
   */
  async cancelResponse(
    id: string
  ): Promise<{ id: string; status: string; raw: any }> {
    const res = await this.fetchWithAuth(`/responses/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: this.jsonHeaders()
    })

    if (!res.ok) {
      throw await this.buildError(res)
    }

    const json = await res.json()
    return {
      id: json.id || id,
      status: json.status || 'cancelled',
      raw: json
    }
  }

  /**
   * Stream a response as text/event-stream.
   * Returns an async iterator of normalized events.
   */
  async *streamResponse(
    options: CreateResponseOptions
  ): AsyncIterable<ResponsesStreamEvent> {
    const body = await this.buildRequestBody(options, { stream: true })

    const res = await this.fetchWithAuth('/responses', {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body)
    })

    if (!res.ok || !res.body) {
      const err = await this.buildError(res, body).catch(e => e)
      try {
        errorTracking.record(err as Error, { type: 'llm', agent: 'ResponsesClient', status: (err as any)?.status, code: (err as any)?.code, requestId: (err as any)?.requestId })
      } catch {
        // Ignore error tracking failures
      }
      yield { type: 'error', error: err }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let lastJson: any = null
    let fellBack = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean)

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue
          }
          const data = line.slice('data:'.length).trim()
          if (!data || data === '[DONE]') {
            continue
          }

          try {
            const parsed = JSON.parse(data)
            lastJson = parsed

            // Text delta event
            const textDelta = this.extractTextDelta(parsed)
            if (textDelta) {
              fullText += textDelta
              yield { type: 'text-delta', delta: textDelta }
            }
            // Graceful degradation: if an error/failure event appears, do one non-stream attempt
            if (
              !fellBack &&
              parsed && typeof parsed.type === 'string' &&
              (parsed.type === 'response.failed' || parsed.type === 'error' || /\.error$/.test(parsed.type))
            ) {
              fellBack = true
              try {
                const nonStream = await this.createResponse(options)
                if (nonStream && typeof nonStream.outputText === 'string') {
                  if (nonStream.outputText) {
                    yield { type: 'text-delta', delta: nonStream.outputText }
                  }
                  yield { type: 'message-complete', result: nonStream }
                  return
                }
              } catch (e) {
                yield { type: 'error', error: e as Error }
                return
              }
            }
          } catch (e) {
            yield {
              type: 'error',
              error: new Error(
                `[ResponsesClient] Failed to parse SSE data chunk: ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (lastJson) {
      // If we got a final structured response object, expose it.
      const result = this.toResult(lastJson, fullText)
      yield { type: 'message-complete', result }
    } else if (fullText) {
      // Fallback: create a synthetic result with just text.
      const synthetic: ResponsesResult = {
        id: '',
        status: 'completed',
        outputText: fullText,
        messages: [],
        raw: null
      }
      yield { type: 'message-complete', result: synthetic }
    }
  }

  /**
   * Convenience: iterate only raw text deltas.
   */
  async *streamText(
    options: CreateResponseOptions
  ): AsyncIterable<string> {
    for await (const ev of this.streamResponse(options)) {
      if (ev.type === 'text-delta') {
        yield ev.delta
      }
    }
  }

  // ===== Internal helpers =====

  private async buildRequestBody(
    options: CreateResponseOptions,
    flags: { stream: boolean }
  ): Promise<Record<string, unknown>> {
    const model = options.model ?? this.config.defaultModel
    const input = buildInputItemsFromMessages(options.messages)

    const body: Record<string, unknown> = {
      model,
      input,
      stream: flags.stream
    }

    // Some Azure-hosted models (e.g. gpt-5-mini / strict variants) reject unsupported params
    // like `temperature`/`top_p`. Respect that by only sending these when non-strict.
    const isStrictModel =
      typeof model === 'string' &&
      /gpt-5-mini(-strict)?|^o1(\b|-)|instruct-strict/i.test(model)

    const safeOptions = isStrictModel
      ? {
          // For strict models: let Azure defaults apply, do not send sampling params.
        }
      : {
          temperature:
            typeof options.temperature === 'number'
              ? options.temperature
              : undefined,
          topP:
            typeof options.topP === 'number'
              ? options.topP
              : undefined
        }

    if (safeOptions.temperature !== undefined) {
      body.temperature = safeOptions.temperature
    }
    if (safeOptions.topP !== undefined) {
      body.top_p = safeOptions.topP
    }

    const maxOut =
      options.maxOutputTokens ??
      this.config.defaultMaxOutputTokens
    if (maxOut && maxOut > 0) {
      body.max_output_tokens = maxOut
    }

    // Do NOT re-add temperature/top_p here; safeOptions above already handled
    // strict-model filtering. Re-adding would reintroduce unsupported params
    // for models like gpt-5-mini and o1 variants.

    const store =
      typeof options.store === 'boolean'
        ? options.store
        : this.config.defaultStore
    if (typeof store === 'boolean') {
      body.store = store
    }

    const background =
      typeof options.background === 'boolean'
        ? options.background
        : this.config.defaultBackground
    if (typeof background === 'boolean') {
      body.background = background
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
    }
    if (options.toolChoice !== undefined) {
      body.tool_choice = options.toolChoice
    }

    // Map high-level responseFormat helper into spec-aligned text.format structure
    if (options.responseFormat) {
      const ensureTextContainer = () => {
        if (!body.text || typeof body.text !== 'object') {
          body.text = {}
        }
        return body.text as Record<string, unknown>
      }

      const target = ensureTextContainer()

      if (options.responseFormat.type === 'text') {
        target.format = { type: 'text' }
      } else if (options.responseFormat.type === 'json_object') {
        target.format = { type: 'json_object' }
      } else if (options.responseFormat.type === 'json_schema') {
        const formatSource = options.responseFormat.json_schema || {}
        const hasWrapper =
          formatSource && typeof formatSource === 'object' && 'schema' in formatSource

        const schemaCandidate = hasWrapper
          ? (formatSource as { schema?: Record<string, unknown> }).schema
          : (formatSource as Record<string, unknown>)

        const schema =
          schemaCandidate && typeof schemaCandidate === 'object'
            ? (schemaCandidate as Record<string, unknown>)
            : {}

        const name =
          hasWrapper && typeof (formatSource as { name?: unknown }).name === 'string'
            ? ((formatSource as { name: string }).name.trim() || 'response')
            : 'response'

        const description =
          hasWrapper && typeof (formatSource as { description?: unknown }).description === 'string'
            ? (formatSource as { description: string }).description
            : undefined

        const strict =
          hasWrapper && typeof (formatSource as { strict?: unknown }).strict === 'boolean'
            ? (formatSource as { strict: boolean }).strict
            : undefined

        target.format = {
          type: 'json_schema',
          name,
          schema,
          ...(description ? { description } : {}),
          ...(strict !== undefined ? { strict } : {})
        }
      }
    }

    // Response chaining
    if (options.previousResponseId) {
      body.previous_response_id = options.previousResponseId
    }

    // System instructions
    if (options.instructions) {
      body.instructions = options.instructions
    }

    // Reasoning configuration
    if (options.reasoning) {
      body.reasoning = options.reasoning
    }

    if (options.extraBody) {
      Object.assign(body, options.extraBody)
    }

    return body
  }

  private async fetchWithAuth(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const url = `${this.config.endpoint}/openai/v1${path}`

    const headers: Record<string, string> = {
      ...(this.config.defaultHeaders || {}),
      ...(init.headers as Record<string, string>),
      // Azure v1 spec uses 'api-key' or 'authorization' (case-insensitive) via securitySchemes
    }

    const usingApiKey = !!this.config.apiKey
    const usingTokenProvider = !!this.config.tokenProvider

    if (usingApiKey) {
      headers['api-key'] = this.config.apiKey as string
    } else if (usingTokenProvider) {
      const token = await (this.config.tokenProvider as () => Promise<string>)()
      headers['Authorization'] = `Bearer ${token}`
    }

    // Set explicit api-version header when configured; otherwise default is v1.
    if (this.config.apiVersion) {
      headers['api-version'] = this.config.apiVersion
    }

    const controller =
      this.config.timeoutMs && typeof AbortController !== 'undefined'
        ? new AbortController()
        : undefined
    const timeout =
      controller && this.config.timeoutMs
        ? setTimeout(() => controller.abort(), this.config.timeoutMs)
        : null

    const doFetch = async (hdrs: Record<string, string>): Promise<Response> => {
      // Add lightweight retry/backoff for transient errors
      return await (this as any).fetchWithRetry?.(url, { ...init, headers: hdrs, signal: controller?.signal })
        ?? fetch(url, { ...init, headers: hdrs, signal: controller?.signal })
    }

    try {
      // First attempt
      let res = await doFetch(headers)
      // If RBAC token flow is used, refresh once on 401/403
      if (usingTokenProvider && (res.status === 401 || res.status === 403)) {
        try {
          const fresh = await (this.config.tokenProvider as () => Promise<string>)()
          const hdrs = { ...headers, Authorization: `Bearer ${fresh}` }
          res = await doFetch(hdrs)
        } catch {
          // ignore refresh failures; return original
        }
      }
      return res
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  // Retry/backoff helpers
  private async fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
    let attempt = 0
    while (true) {
      const res = await fetch(url, init)
      if (!this.shouldRetry(res, attempt, maxRetries)) return res
      attempt++
      const delayMs = this.computeBackoff(res, attempt)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }

  private shouldRetry(res: Response, attempt: number, maxRetries: number): boolean {
    if (attempt >= maxRetries) return false
    const status = res.status
    return [429, 500, 502, 503, 504].includes(status)
  }

  private computeBackoff(res: Response, attempt: number): number {
    const hdr = res.headers.get('Retry-After')
    if (hdr) {
      const sec = parseInt(hdr, 10)
      if (!Number.isNaN(sec) && sec > 0) return sec * 1000
    }
    const base = 500 * Math.pow(2, attempt)
    const jitter = Math.random() * 250
    return Math.min(base + jitter, 8000)
  }

  private jsonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.config.defaultHeaders || {})
    }
  }

  private async buildError(
    res: Response,
    body?: Record<string, unknown>
  ): Promise<Error> {
    let parsed: any = null
    try {
      parsed = await res.json()
    } catch {
      // ignore
    }

    const message =
      parsed?.error?.message ||
      parsed?.message ||
      `Responses API request failed with status ${res.status}`

    const err = new Error(
      `[ResponsesClient] ${message}`
    ) as Error & {
      status?: number
      code?: string
      requestId?: string | null
      responseBody?: any
      requestBody?: any
    }

    err.status = res.status
    err.code = parsed?.error?.code
    err.requestId =
      res.headers.get('x-ms-request-id') ||
      res.headers.get('apim-request-id')
    err.responseBody = parsed
    if (body) {
      // sanitized: no secrets stored here
      err.requestBody = body
    }

    try {
      errorTracking.record(err, {
        type: 'llm',
        agent: 'ResponsesClient',
        code: err.code,
        status: err.status,
        requestId: err.requestId ?? undefined
      })
    } catch {
      // ignore telemetry failures
    }
    return err
  }

  private redactSensitiveData(text: string): string {
    return (text || '')
      // OpenAI-style keys
      .replace(/\bsk-[A-Za-z0-9-_]{20,}\b/g, '[REDACTED_API_KEY]')
      // long tokens (alnum, -, _, with optional padding)
      .replace(/\b[A-Za-z0-9\-_]{32,}={0,2}\b/g, '[REDACTED_TOKEN]')
      // generic 32+ alphanumeric
      .replace(/\b[A-Za-z0-9]{32,}\b/g, '[REDACTED_TOKEN]')
  }

  private extractReasoningPreview(json: any, maxLength = 2000): string | undefined {
    const candidates: string[] = []

    // Top-level reasoning fields
    if (typeof (json as any)?.reasoning_summary_text === 'string') {
      candidates.push((json as any).reasoning_summary_text)
    }
    if (typeof (json as any)?.reasoning_content === 'string') {
      candidates.push((json as any).reasoning_content)
    }
    if ((json as any)?.reasoning && typeof (json as any).reasoning === 'object') {
      const rr = (json as any).reasoning
      if (typeof rr.summary_text === 'string') candidates.push(rr.summary_text)
      if (typeof rr.text === 'string') candidates.push(rr.text)
      if (typeof rr.content === 'string') candidates.push(rr.content as string)
    }

    // Nested under response
    if (json?.response && typeof json.response === 'object') {
      const r = json.response
      if (typeof (r as any)?.reasoning_summary_text === 'string') {
        candidates.push((r as any).reasoning_summary_text)
      }
      if (typeof (r as any)?.reasoning_content === 'string') {
        candidates.push((r as any).reasoning_content)
      }
      if ((r as any)?.reasoning && typeof (r as any).reasoning === 'object') {
        const rr = (r as any).reasoning
        if (typeof rr.summary_text === 'string') candidates.push(rr.summary_text)
        if (typeof rr.text === 'string') candidates.push(rr.text)
        if (typeof rr.content === 'string') candidates.push(rr.content as string)
      }
    }

    // From output reasoning items
    if (Array.isArray(json?.output)) {
      for (const item of json.output) {
        if (!item) continue
        // Reasoning items have a 'summary' array, not 'content'
        if (item.type === 'reasoning' && Array.isArray(item.summary)) {
          for (const part of item.summary) {
            if (part?.type === 'summary_text' && typeof part?.text === 'string') {
              candidates.push(part.text)
            }
          }
        }
      }
    }

    if (!candidates.length) return undefined
    const combined = candidates.join('\n---\n')
    const truncated = combined.length > maxLength
      ? combined.slice(0, maxLength) + '...[truncated]'
      : combined
    return this.redactSensitiveData(truncated)
  }

  private toResult(json: any, overrideText?: string): ResponsesResult {
    const outputText =
      overrideText ??
      this.extractFirstOutputText(json) ??
      ''

    const messages: ResponseMessage[] = Array.isArray(json.output)
      ? json.output
          .filter((item: any) => item && item.type === 'message')
          .map((item: any) => ({
            id: item.id,
            role: item.role as ResponseRole,
            content: Array.isArray(item.content)
              ? item.content.map((c: any) => ({
                  type: c.type,
                  text: c.text,
                  ...c
                }))
              : []
          }))
      : []

    const usage: ResponsesUsage | undefined = json.usage
      ? {
          inputTokens: numberOrUndefined(json.usage.input_tokens),
          outputTokens: numberOrUndefined(json.usage.output_tokens),
          totalTokens: numberOrUndefined(json.usage.total_tokens),
          reasoningTokens: json.usage.output_tokens_details
            ? numberOrUndefined(
                json.usage.output_tokens_details.reasoning_tokens
              )
            : undefined
        }
      : undefined

    const reasoningPreview = this.extractReasoningPreview(json)

    return {
      id: json.id,
      status: json.status ?? 'completed',
      model: json.model,
      outputText,
      messages,
      usage,
      raw: json,
      reasoningPreview
    }

    function numberOrUndefined(v: any): number | undefined {
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    }
  }

  private extractFirstOutputText(json: any): string | undefined {
    if (!json) return undefined

    // Be resilient on incomplete responses: still attempt extraction
    if (json.status === 'incomplete') {
      try {
        console.warn('[ResponsesClient] Incomplete response; attempting to extract partial output', { id: json.id })
        // Debug: log the full response to see actual structure
        if (Array.isArray(json.output) && json.output.length > 0) {
          console.debug('[ResponsesClient] Output array contents:', JSON.stringify(json.output, null, 2))
        }
      } catch {}
    }

    // 1) Simple top-level fields
    if (typeof json.text === 'string') return json.text
    if (typeof json.output_text === 'string') return json.output_text
    if (typeof (json as any).reasoning_summary_text === 'string') return (json as any).reasoning_summary_text
    if (typeof (json as any).reasoning_content === 'string') return (json as any).reasoning_content
    if ((json as any).reasoning && typeof (json as any).reasoning === 'object') {
      const rr = (json as any).reasoning
      if (typeof rr.summary_text === 'string') return rr.summary_text
      if (typeof rr.text === 'string') return rr.text
    }

    // 2) Nested under "response"
    if (json.response && typeof json.response === 'object') {
      const r = json.response
      if (typeof r.output_text === 'string') return r.output_text
      if (typeof r.text === 'string') return r.text
      if (typeof (r as any).reasoning_summary_text === 'string') return (r as any).reasoning_summary_text
      if (typeof (r as any).reasoning_content === 'string') return (r as any).reasoning_content
      if ((r as any).reasoning && typeof (r as any).reasoning === 'object') {
        const rr = (r as any).reasoning
        if (typeof rr.summary_text === 'string') return rr.summary_text
        if (typeof rr.text === 'string') return rr.text
      }
    }

    // 3) Prefer reasoning items explicitly before general text extraction
    const reasoningChunks = this.extractReasoningChunks(json.output)
    if (reasoningChunks.length) {
      return reasoningChunks.join('')
    }

    // 4) Gather assistant/tool text regardless of the exact content shape
    const outputChunks = this.collectTextFromOutput(json.output)
    if (outputChunks.length) {
      return outputChunks.join('')
    }

    // 6) Final fallback: some APIs put a human-readable message here
    if (typeof (json as any).message === 'string') return (json as any).message

    // Log when we can't extract text to help diagnose API response structure issues
    console.warn('[ResponsesClient] Failed to extract output text. Response structure:', {
      hasText: 'text' in json,
      hasOutputText: 'output_text' in json,
      hasResponse: 'response' in json,
      hasOutput: Array.isArray(json.output),
      outputLength: Array.isArray(json.output) ? json.output.length : 0,
      firstOutputType: Array.isArray(json.output) && json.output[0] ? json.output[0].type : null,
      status: json.status,
      id: json.id
    })

    return undefined
  }

  private extractReasoningChunks(output: any): string[] {
    if (!Array.isArray(output)) {
      return []
    }
    const reasoningChunks: string[] = []
    for (const item of output) {
      if (!item || item.type !== 'reasoning') continue
      try {
        console.debug('[ResponsesClient] Found reasoning item. Keys:', Object.keys(item), 'Full item:', item)
        if (Array.isArray(item.summary)) {
          console.debug('[ResponsesClient] Summary array length:', item.summary.length)
          for (const part of item.summary) {
            console.debug('[ResponsesClient] Summary part:', part)
            if (part?.type === 'summary_text' && typeof part?.text === 'string') {
              reasoningChunks.push(part.text)
            }
          }
        } else {
          console.warn('[ResponsesClient] Reasoning item missing summary array. Has:', Object.keys(item))
        }
      } catch {
        // best-effort diagnostics only
      }
    }
    if (reasoningChunks.length) {
      console.debug('[ResponsesClient] Successfully extracted reasoning chunks:', reasoningChunks.length)
    }
    return reasoningChunks
  }

  private collectTextFromOutput(output: any): string[] {
    if (!Array.isArray(output)) {
      return []
    }
    const chunks: string[] = []
    for (const item of output) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.output_text === 'string') {
        chunks.push(item.output_text)
      }
      if (typeof item.text === 'string' && item.type !== 'input_text') {
        chunks.push(item.text)
      }
      if (Array.isArray(item.text)) {
        for (const textPart of item.text) {
          if (typeof textPart === 'string' && textPart.length) {
            chunks.push(textPart)
          }
        }
      }
      if (item.content !== undefined) {
        chunks.push(...this.collectTextFromContentNode(item.content))
      }
      if (Array.isArray(item.summary)) {
        for (const part of item.summary) {
          if (typeof part?.text === 'string') {
            chunks.push(part.text)
          }
        }
      }
      if (Array.isArray(item.output)) {
        chunks.push(...this.collectTextFromOutput(item.output))
      }
    }
    return chunks.filter(text => typeof text === 'string' && text.length > 0)
  }

  private collectTextFromContentNode(node: any): string[] {
    if (node === null || node === undefined) {
      return []
    }
    if (Array.isArray(node)) {
      return node.flatMap(part => this.collectTextFromContentNode(part))
    }
    if (typeof node === 'string') {
      return node.length ? [node] : []
    }
    if (typeof node !== 'object') {
      return []
    }

    const type = typeof node.type === 'string' ? node.type : undefined
    if (type === 'input_text') {
      return []
    }

    if ((type === 'output_text' || type === 'text') && typeof node.text === 'string') {
      return node.text.length ? [node.text] : []
    }

    if ((type === 'output_json' || type === 'json') && node.json !== undefined) {
      try {
        return [typeof node.json === 'string' ? node.json : JSON.stringify(node.json)]
      } catch {
        return []
      }
    }

    if (typeof node.text === 'string' && node.text.length) {
      return [node.text]
    }

    if (typeof node.value === 'string' && node.value.length) {
      return [node.value]
    }

    if (typeof node.arguments === 'string' && node.arguments.length) {
      return [node.arguments]
    }

    if (Array.isArray(node.arguments)) {
      return node.arguments
        .map(arg => {
          if (typeof arg === 'string') return arg
          try {
            return JSON.stringify(arg)
          } catch {
            return undefined
          }
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    }

    if (node.content !== undefined) {
      return this.collectTextFromContentNode(node.content)
    }

    return []
  }

  private extractTextDelta(parsed: any): string | null {
    // Handle incremental output events for Responses stream.
    // Different implementations may emit specialized event types; we treat
    // any `output_text.delta`-like payloads as text.
    try {
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') {
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          return parsed.delta
        }
        // Reasoning summary text delta
        if (parsed.type === 'response.reasoning_summary_text.delta' && typeof parsed.delta === 'string') {
          return parsed.delta
        }
        // Reasoning delta (model emits incremental reasoning content)
        if (parsed.type === 'response.reasoning.delta' && typeof parsed.delta === 'string') {
          return parsed.delta
        }
        // Some variants use "response.reasoning_summary.delta"
        if (parsed.type === 'response.reasoning_summary.delta' && typeof parsed.delta === 'string') {
          return parsed.delta
        }
      }
    } catch {}
    return null
  }
}
