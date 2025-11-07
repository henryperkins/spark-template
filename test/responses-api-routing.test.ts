import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AzureOpenAIService } from '../src/lib/azure-openai'
import type { AzureConfig } from '../src/types'

/**
 * Responses API Routing Tests
 *
 * These tests ensure that when useResponsesApi=true, ALL chat/RAG operations
 * go through /openai/v1/responses and NEVER hit /chat/completions.
 *
 * When useResponsesApi=false, /chat/completions is used as expected.
 *
 * Embeddings always use the embeddings endpoint (by design).
 */

describe('Responses API Routing', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Mock global fetch
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('With useResponsesApi=true', () => {
    const createService = (overrides = {}) => {
      const config: AzureConfig['openai'] = {
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'test-key',
        deploymentName: 'gpt-4o',
        embeddingDeploymentName: 'text-embedding-3-large',
        apiVersion: '2025-08-01-preview',
        useResponsesApi: true,
        responsesModel: 'gpt-4o',
        responsesApiVersion: 'v1',
        ...overrides
      }
      return new AzureOpenAIService(config)
    }

    it('uses /openai/v1/responses for generateCompletion (non-streaming)', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_123',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Hello!' }]
              }
            ],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateCompletion('Test message')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/openai/v1/responses')
      expect(callUrl).not.toContain('/chat/completions')
    })

    it('uses /openai/v1/responses for generateCompletion (streaming)', async () => {
      const service = createService()

      // Mock streaming response
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n')
          )
          controller.enqueue(
            encoder.encode('data: {"type":"response.output_text.delta","delta":" world"}\n\n')
          )
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })

      fetchSpy.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )

      const chunks: string[] = []
      await service.generateCompletion('Test message', {
        stream: true,
        onChunk: (chunk) => chunks.push(chunk)
      })

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/openai/v1/responses')
      expect(callUrl).not.toContain('/chat/completions')
      expect(chunks.join('')).toBe('Hello world')
    })

    it('uses /openai/v1/responses for generateCompletionWithUsage', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_456',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Response text' }]
              }
            ],
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const result = await service.generateCompletionWithUsage('Test message')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/openai/v1/responses')
      expect(callUrl).not.toContain('/chat/completions')
      expect(result.text).toBe('Response text')
      expect(result.usage?.promptTokens).toBe(20)
      expect(result.usage?.completionTokens).toBe(10)
    })

    it('uses /openai/v1/responses for generateRAGResponse', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_789',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'RAG response' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const response = await service.generateRAGResponse(
        'What is RAG?',
        '[1] RAG stands for Retrieval-Augmented Generation'
      )

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/openai/v1/responses')
      expect(callUrl).not.toContain('/chat/completions')
      expect(response).toBe('RAG response')
    })

    it('uses /openai/v1/responses for generateRAGResponseWithMetadata', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_abc',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'RAG response with metadata' }]
              }
            ],
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const result = await service.generateRAGResponseWithMetadata(
        'Query',
        'Context'
      )

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/openai/v1/responses')
      expect(callUrl).not.toContain('/chat/completions')
      expect(result.text).toBe('RAG response with metadata')
      expect(result.responseId).toBe('resp_abc')
      expect(result.usage?.totalTokens).toBe(150)
    })

    it('extracts system instructions and uses instructions parameter', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_sys',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Response' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateCompletion([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' }
      ])

      expect(fetchSpy).toHaveBeenCalledOnce()
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)

      // Should have instructions field
      expect(requestBody.instructions).toBe('You are a helpful assistant')

      // Input should only have user message
      expect(requestBody.input).toHaveLength(1)
      expect(requestBody.input[0].role).toBe('user')
    })
  })

  describe('With useResponsesApi=false', () => {
    const createService = () => {
      const config: AzureConfig['openai'] = {
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'test-key',
        deploymentName: 'gpt-4o',
        embeddingDeploymentName: 'text-embedding-3-large',
        apiVersion: '2025-08-01-preview',
        useResponsesApi: false
      }
      return new AzureOpenAIService(config)
    }

    it('uses /chat/completions for generateCompletion (non-streaming)', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: 'Hello!' }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateCompletion('Test message')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/chat/completions')
      expect(callUrl).not.toContain('/openai/v1/responses')
    })

    it('uses /chat/completions for generateCompletionWithUsage', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: 'Response' }
              }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      const result = await service.generateCompletionWithUsage('Test message')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/chat/completions')
      expect(callUrl).not.toContain('/openai/v1/responses')
      expect(result.text).toBe('Response')
    })

    it('uses /chat/completions for generateRAGResponse', async () => {
      const service = createService()

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: 'RAG response' }
              }
            ],
            usage: { total_tokens: 50 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateRAGResponse('Query', 'Context')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/chat/completions')
      expect(callUrl).not.toContain('/openai/v1/responses')
    })
  })

  describe('Embeddings endpoint (always used regardless of useResponsesApi)', () => {
    it('uses embeddings endpoint when useResponsesApi=true', async () => {
      const config: AzureConfig['openai'] = {
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'test-key',
        deploymentName: 'gpt-4o',
        embeddingDeploymentName: 'text-embedding-3-large',
        apiVersion: '2025-08-01-preview',
        useResponsesApi: true
      }
      const service = new AzureOpenAIService(config)

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateEmbedding('Test text')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/embeddings')
      expect(callUrl).not.toContain('/responses')
      expect(callUrl).not.toContain('/chat/completions')
    })

    it('uses embeddings endpoint when useResponsesApi=false', async () => {
      const config: AzureConfig['openai'] = {
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'test-key',
        deploymentName: 'gpt-4o',
        embeddingDeploymentName: 'text-embedding-3-large',
        apiVersion: '2025-08-01-preview',
        useResponsesApi: false
      }
      const service = new AzureOpenAIService(config)

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateEmbedding('Test text')

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/embeddings')
      expect(callUrl).not.toContain('/responses')
      expect(callUrl).not.toContain('/chat/completions')
    })

    it('uses embeddings endpoint for batch embeddings', async () => {
      const config: AzureConfig['openai'] = {
        endpoint: 'https://test.openai.azure.com',
        apiKey: 'test-key',
        deploymentName: 'gpt-4o',
        embeddingDeploymentName: 'text-embedding-3-large',
        apiVersion: '2025-08-01-preview',
        useResponsesApi: true
      }
      const service = new AzureOpenAIService(config)

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { embedding: [0.1, 0.2] },
              { embedding: [0.3, 0.4] }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )

      await service.generateBatchEmbeddings(['Text 1', 'Text 2'])

      expect(fetchSpy).toHaveBeenCalledOnce()
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('/embeddings')
      expect(callUrl).not.toContain('/responses')
    })
  })
})
