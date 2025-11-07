import { AzureConfig } from '@/types'

export class AzureOpenAIService {
  private config: AzureConfig['openai']

  constructor(config: AzureConfig['openai']) {
    this.config = config
    // Normalize endpoint to avoid double slashes in request URLs
    this.config.endpoint = this.config.endpoint.replace(/\/+$/, '')
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.config.endpoint}/openai/models?api-version=${this.config.apiVersion}`,
        {
          method: 'GET',
          headers: {
            'api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(
        `${this.config.endpoint}/openai/deployments/${this.config.embeddingDeploymentName}/embeddings?api-version=${this.config.apiVersion}`,
        {
          method: 'POST',
          headers: {
            'api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: text,
            encoding_format: 'float'
          })
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Embedding generation failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      return data.data[0].embedding
    } catch (error) {
      console.error('Error generating embedding:', error)
      throw error
    }
  }

  async generateBatchEmbeddings(
    texts: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<number[][]> {
    // Automatically batch large inputs to avoid request size/token limits.
    const maxBatchSize = 64
    const results: number[][] = []
    const total = texts.length
    let done = 0

    // Helper to POST a single batch; reduces batch size on 413/400 if needed.
    const postBatch = async (batch: string[], attemptSize: number): Promise<number[][]> => {
      try {
        const response = await fetch(
          `${this.config.endpoint}/openai/deployments/${this.config.embeddingDeploymentName}/embeddings?api-version=${this.config.apiVersion}`,
          {
            method: 'POST',
            headers: {
              'api-key': this.config.apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              input: batch,
              encoding_format: 'float'
            })
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          // Reduce batch size on payload/limit errors and retry
          if ((response.status === 400 || response.status === 413) && attemptSize > 1) {
            const nextSize = Math.max(1, Math.floor(attemptSize / 2))
            const out: number[][] = []
            for (let i = 0; i < batch.length; i += nextSize) {
              const sub = batch.slice(i, i + nextSize)
              const subRes = await postBatch(sub, nextSize)
              out.push(...subRes)
            }
            return out
          }
          throw new Error(`Batch embedding generation failed: ${response.status} ${errorText}`)
        }

        const data = await response.json()
        return data.data.map((item: { embedding: number[] }) => item.embedding)
      } catch (error) {
        console.error('Error generating batch embeddings:', error)
        throw error
      }
    }

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize)
      const embeddings = await postBatch(batch, Math.min(batch.length, maxBatchSize))
      results.push(...embeddings)
      done += batch.length
      if (onProgress) {
        try {
          onProgress(Math.min(done, total), total)
        } catch {
          // ignore callback errors
        }
      }
    }

    return results
  }

  async generateCompletion(
    messages: Array<{ role: string; content: string }> | string,
    options?: {
      maxTokens?: number
      temperature?: number
      topP?: number
      responseFormat?: 'text' | 'json_object'
      stream?: boolean
      onChunk?: (chunk: string) => void
    }
  ): Promise<string> {
    try {
      const messageArray = typeof messages === 'string'
        ? [{ role: 'user', content: messages }]
        : messages

      const requestBody: Record<string, unknown> = {
        messages: messageArray,
        max_tokens: options?.maxTokens ?? 2000,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: options?.stream ?? false
      }

      if (options?.responseFormat === 'json_object') {
        requestBody.response_format = { type: 'json_object' }
      }

      if (this.config.enableStoredCompletions) {
        requestBody.store = true
      }

      const response = await fetch(
        `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.config.apiVersion}`,
        {
          method: 'POST',
          headers: {
            'api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Completion generation failed: ${response.status} ${errorText}`)
      }

      if (options?.stream && response.body) {
        return await this.handleStreamingResponse(response.body, options.onChunk)
      }

      const data = await response.json()
      return data.choices[0].message.content
    } catch (error) {
      console.error('Error generating completion:', error)
      throw error
    }
  }

  private async handleStreamingResponse(
    body: ReadableStream<Uint8Array>,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(line => line.trim() !== '')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                fullContent += content
                if (onChunk) {
                  onChunk(content)
                }
              }
            } catch (e) {
              console.warn('Failed to parse streaming chunk:', e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return fullContent
  }

  async generateRAGResponse(query: string, context: string): Promise<string> {
    const messages = [
      {
        role: 'system',
        content: `You are a helpful research assistant. Answer the user's question based on the provided context from documents. Be accurate and cite your sources using the numbers in brackets when applicable.

Context from documents:
${context}`
      },
      {
        role: 'user',
        content: query
      }
    ]

    return this.generateCompletion(messages)
  }
}
