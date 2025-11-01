import { z } from 'zod'
import { Source } from '@/types'
import { llmService } from '../services/llm-service'

export interface ValidationResult {
  isValid: boolean
  confidence: number
  issues: string[]
  suggestions: string[]
  faithfulnessScore: number
  relevanceScore: number
}

const validationResultSchema: z.ZodType<ValidationResult> = z.object({
  isValid: z.boolean(),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  faithfulnessScore: z.number().min(0).max(1),
  relevanceScore: z.number().min(0).max(1)
})

export class CriticAgent {
  async validateResponse(
    query: string,
    response: string,
    sources: Source[]
  ): Promise<ValidationResult> {
    const contextSnippets = sources
      .map((s, i) => `[${i + 1}] ${s.content}`)
      .join('\n')

    const systemPrompt = `You are a fact-checking expert. Validate AI responses against source documents.

Evaluation criteria:
1. FAITHFULNESS: Is the response supported by the sources? No hallucinations?
2. RELEVANCE: Does the response actually answer the question?
3. ACCURACY: Are facts correctly stated?
4. CITATIONS: Are sources properly referenced?

Identify issues:
- Unsupported claims not in sources
- Incorrect facts
- Missing important information from sources
- Irrelevant content

Respond with JSON:
{
  "isValid": boolean,
  "confidence": 0.0-1.0,
  "issues": ["list of problems"],
  "suggestions": ["how to improve"],
  "faithfulnessScore": 0.0-1.0,
  "relevanceScore": 0.0-1.0
}`

    try {
      const prompt = (window as any).spark.llmPrompt`${systemPrompt}

Source documents:
${contextSnippets}

User question: ${query}

AI response to validate:
${response}

Provide validation as JSON:`

      return await llmService.generateJson(prompt, validationResultSchema, {
        maxTokens: 500,
        temperature: 0.3
      })
    } catch (error) {
      console.warn('LLM validation failed, using fallback:', error)
    }

    return this.fallbackValidation(query, response, sources)
  }

  private fallbackValidation(
    query: string,
    response: string,
    sources: Source[]
  ): ValidationResult {
    const lowerResponse = response.toLowerCase()
    const lowerQuery = query.toLowerCase()
    
    const hasCitations = /\[[\d,\s]+\]/.test(response)
    
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 3)
    const matchingWords = queryWords.filter(word => lowerResponse.includes(word))
    const relevanceScore = matchingWords.length / Math.max(queryWords.length, 1)
    
    const sourceWords = new Set(
      sources.flatMap(s => s.content.toLowerCase().split(/\s+/))
    )
    const responseWords = lowerResponse.split(/\s+/).filter(w => w.length > 4)
    const supportedWords = responseWords.filter(word => sourceWords.has(word))
    const faithfulnessScore = supportedWords.length / Math.max(responseWords.length, 1)
    
    const issues: string[] = []
    const suggestions: string[] = []
    
    if (!hasCitations) {
      issues.push('Response lacks source citations')
      suggestions.push('Add citations to reference sources')
    }
    
    if (faithfulnessScore < 0.5) {
      issues.push('Response may contain unsupported claims')
      suggestions.push('Ensure all facts are from provided sources')
    }
    
    if (relevanceScore < 0.4) {
      issues.push('Response may not fully address the query')
      suggestions.push('Focus response more directly on the question')
    }
    
    const isValid = issues.length === 0 && faithfulnessScore > 0.6 && relevanceScore > 0.5

    return {
      isValid,
      confidence: isValid ? 0.7 : 0.5,
      issues,
      suggestions,
      faithfulnessScore: Math.min(faithfulnessScore, 1.0),
      relevanceScore: Math.min(relevanceScore, 1.0)
    }
  }
}
