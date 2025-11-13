import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AzureOpenAIService } from '../src/lib/azure-openai'
import type { AzureConfig } from '../src/types'
import { ResponsesClient } from '../src/lib/responses-client'

describe('Responses resiliency and fallbacks', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws on missing embeddingDeploymentName', () => {
    const badConfig = {
      endpoint: 'https://test.openai.azure.com',
      apiKey: 'test-key',
      deploymentName: 'gpt-4o',
      apiVersion: '2025-08-01-preview',
      useResponsesApi: false,
    } as AzureConfig['openai']

    expect(() => new AzureOpenAIService(badConfig)).toThrow(
      'Azure OpenAI embeddingDeploymentName is required for embeddings'
    )
  })

  it('falls back to /chat/completions on retriable Responses failure when enabled', async () => {
    const config: AzureConfig['openai'] = {
      endpoint: 'https://test.openai.azure.com',
      apiKey: 'test-key',
      deploymentName: 'gpt-4o',
      embeddingDeploymentName: 'text-embedding-3-large',
      apiVersion: '2025-08-01-preview',
      useResponsesApi: true,
      responsesModel: 'gpt-4o',
      responsesApiVersion: 'v1',
      responsesFallbackEnabled: true,
    }
    const service = new AzureOpenAIService(config)

    // First: Responses API returns a retriable 503
    // Then: Chat completions returns a normal reply
    fetchSpy.mockImplementation((input: any, init?: any) => {
      const url = String(input)
      if (url.includes('/openai/v1/responses')) {
        return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Service Unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } }))
      }
      if (url.includes('/chat/completions')) {
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Fallback OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    const text = await service.generateCompletion('Hello')
    expect(text).toBe('Fallback OK')
    // Ensure both endpoints were called
    const calls = fetchSpy.mock.calls.map(c => String(c[0]))
    expect(calls.some(u => u.includes('/openai/v1/responses'))).toBe(true)
    expect(calls.some(u => u.includes('/chat/completions'))).toBe(true)
  }, 15000)

  it('ResponsesClient refreshes token on 401/403 once', async () => {
    const client = new ResponsesClient({
      endpoint: 'https://test.openai.azure.com',
      defaultModel: 'gpt-4o',
      tokenProvider: vi
        .fn()
        // first call -> stale token
        .mockResolvedValueOnce('stale-token')
        // second call -> refreshed token
        .mockResolvedValueOnce('fresh-token'),
    })

    // First attempt 401, second attempt 200
    const encoder = new TextEncoder()
    fetchSpy.mockImplementationOnce(() => Promise.resolve(new Response(encoder.encode('unauthorized'), { status: 401 })))
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'ok', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello!' }] }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    const res = await client.createResponse({
      messages: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
    })
    expect(res.outputText).toBe('Hello!')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('treats reasoning-only incomplete response as INCOMPLETE_NO_TEXT error', async () => {
    const config: AzureConfig['openai'] = {
      endpoint: 'https://test.openai.azure.com',
      apiKey: 'test-key',
      deploymentName: 'gpt-5',
      embeddingDeploymentName: 'text-embedding-3-large',
      apiVersion: '2025-08-01-preview',
      useResponsesApi: true,
      responsesModel: 'gpt-5',
      responsesApiVersion: 'v1',
      responsesFallbackEnabled: true,
    }

    const service = new AzureOpenAIService(config)

    // Reasoning-only, incomplete response should be treated as INCOMPLETE_NO_TEXT
    fetchSpy.mockImplementation(input => {
      const url = String(input)
      if (url.includes('/openai/v1/responses')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'resp_incomplete_reasoning',
              status: 'incomplete',
              model: 'gpt-5',
              output: [
                {
                  id: 'r1',
                  type: 'reasoning',
                  summary: [
                    { type: 'summary_text', text: 'internal trace only' }
                  ]
                }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      }
      return Promise.reject(new Error('Unexpected URL in reasoning-only test'))
    })

    const result = await service.generateCompletion('Hello from reasoning-only test')
    expect(result).toBe('internal trace only')
  })

  it('streaming falls back to non-stream createResponse on SSE failure', async () => {
    const config: AzureConfig['openai'] = {
      endpoint: 'https://test.openai.azure.com',
      apiKey: 'test-key',
      deploymentName: 'gpt-4o',
      embeddingDeploymentName: 'text-embedding-3-large',
      apiVersion: '2025-08-01-preview',
      useResponsesApi: true,
      responsesModel: 'gpt-4o',
      responsesApiVersion: 'v1',
    }
    const service = new AzureOpenAIService(config)

    // Mock SSE that emits a failure event
    const encoder = new TextEncoder()
    const sse = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.failed","message":"bad"}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    // First call: stream
    fetchSpy.mockResolvedValueOnce(new Response(sse as any, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    // Second call: non-stream recovery
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'ok', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Recovered text' }] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const chunks: string[] = []
    await service.generateCompletion('Test', { stream: true, onChunk: c => chunks.push(c) })
    expect(chunks.join('')).toBe('Recovered text')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('ResponsesClient text extraction', () => {
  it('extracts text when assistant message content is not an array', () => {
    const client = new ResponsesClient({ endpoint: 'https://example.com', defaultModel: 'gpt-4o' })
    const sample = {
      id: 'resp_test_object_content',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: {
            type: 'output_text',
            text: 'object-backed text',
            annotations: []
          }
        }
      ]
    }

    const result = (client as any).toResult(sample)
    expect(result.outputText).toBe('object-backed text')
  })

  it('extracts text when output items expose top-level text fields', () => {
    const client = new ResponsesClient({ endpoint: 'https://example.com', defaultModel: 'gpt-4o' })
    const sample = {
      id: 'resp_direct_text',
      status: 'completed',
      output: [
        {
          type: 'output_text',
          text: 'direct text payload',
          annotations: []
        }
      ]
    }

    const result = (client as any).toResult(sample)
    expect(result.outputText).toBe('direct text payload')
  })

  it('ignores input_text content when no assistant output is present', () => {
    const client = new ResponsesClient({ endpoint: 'https://example.com', defaultModel: 'gpt-4o' })
    const sample = {
      id: 'resp_input_only',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'user question'
            }
          ]
        }
      ]
    }

    expect(() => (client as any).toResult(sample)).toThrow(
      '[ResponsesClient] Completed Responses API result without output_text or reasoning; treating as hard error'
    )
  })
})
