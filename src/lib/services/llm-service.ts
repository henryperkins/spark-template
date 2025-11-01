import { ZodSchema } from 'zod'
import { azureServiceManager } from '../azure-service-manager'

type CompletionOptions = {
  maxTokens?: number
  temperature?: number
  topP?: number
  model?: string
}

type CompletionPayload = string | Array<{ role: string; content: string }>

export class LLMService {
  async generateText(
    prompt: CompletionPayload,
    options: CompletionOptions = {}
  ): Promise<string> {
    if (azureServiceManager.isConfigured()) {
      return azureServiceManager.generateCompletion(prompt, {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        topP: options.topP
      })
    }

    return this.callSparkLLM(prompt, options.model)
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
      console.error('JSON schema validation failed:', error)
      throw error
    }
  }

  private async generateRawJson(
    prompt: CompletionPayload,
    options: CompletionOptions
  ): Promise<unknown> {
    if (azureServiceManager.isConfigured()) {
      const response = await azureServiceManager.generateCompletion(prompt, {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        topP: options.topP,
        responseFormat: 'json_object'
      })

      return this.parseJson(response)
    }

    const response = await this.callSparkLLM(prompt, options.model, true)
    return this.parseJson(response)
  }

  private async callSparkLLM(
    prompt: CompletionPayload,
    model?: string,
    forceJson?: boolean
  ): Promise<string> {
    const resolvedPrompt =
      typeof prompt === 'string'
        ? prompt
        : prompt.map(message => message.content).join('\n')

    const spark = (window as any).spark

    if (!spark?.llm) {
      throw new Error('Spark LLM interface not available')
    }

    return spark.llm(resolvedPrompt, model ?? 'gpt-4o-mini', forceJson ?? false)
  }

  private parseJson(response: string): unknown {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const jsonText = jsonMatch ? jsonMatch[0] : response
    return JSON.parse(jsonText)
  }
}

export const llmService = new LLMService()
