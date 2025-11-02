import { z } from 'zod'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'

export type QueryComplexity = 'simple' | 'moderate' | 'complex'

export interface QueryClassification {
  complexity: QueryComplexity
  reasoning: string
  recommendedStrategy: 'direct' | 'planned' | 'iterative'
  requiresDecomposition: boolean
  estimatedSubQueries?: number
}

const queryClassificationSchema: z.ZodType<QueryClassification> = z.object({
  complexity: z.enum(['simple', 'moderate', 'complex']),
  reasoning: z.string().min(5),
  recommendedStrategy: z.enum(['direct', 'planned', 'iterative']),
  requiresDecomposition: z.boolean(),
  estimatedSubQueries: z.number().int().min(1).max(6).optional()
})

export class QueryClassifierAgent {
  async classifyQuery(query: string): Promise<QueryClassification> {
    const systemPrompt = `You are a query classification expert. Analyze the user's query and determine its complexity.

Classification criteria:
- SIMPLE: Single fact retrieval, specific information lookup, yes/no questions
- MODERATE: Requires comparing 2-3 concepts, summarization of a topic, questions with some analysis
- COMPLEX: Multi-faceted questions, requires synthesis from multiple sources, comparative analysis across many items, "how" and "why" questions requiring reasoning

Respond with a JSON object containing:
- complexity: "simple" | "moderate" | "complex"
- reasoning: Brief explanation of classification
- recommendedStrategy: "direct" (simple lookup) | "planned" (decompose into sub-queries) | "iterative" (refine through multiple passes)
- requiresDecomposition: boolean
- estimatedSubQueries: number (if decomposition needed)

Example:
{
  "complexity": "complex",
  "reasoning": "Requires comparing multiple concepts and synthesizing information from various sources",
  "recommendedStrategy": "planned",
  "requiresDecomposition": true,
  "estimatedSubQueries": 3
}`

    try {
      const prompt = (window as any).spark.llmPrompt`${systemPrompt}
${JSON_OUTPUT_REQUIREMENTS}

User query: ${sanitizeQueryForPrompt(query)}

Provide your classification as a JSON object:`

      return await llmService.generateJson(prompt, queryClassificationSchema, {
        maxTokens: appConfig.truncation.classifierMaxTokens,
        temperature: appConfig.temps.classifier
      })
    } catch (error) {
      console.warn('LLM classification failed, using fallback:', error)
    }

    return this.fallbackClassification(query)
  }

  private fallbackClassification(query: string): QueryClassification {
    const questionWords = ['how', 'why', 'explain', 'compare', 'analyze', 'evaluate']
    const multiPartIndicators = ['and', 'versus', 'vs', 'compared to', 'relationship between']

    const lowerQuery = query.toLowerCase()
    const hasQuestionWord = questionWords.some(word => lowerQuery.includes(word))
    const hasMultipleParts = multiPartIndicators.some(ind => lowerQuery.includes(ind))
    const wordCount = query.split(/\s+/).length

    if (hasQuestionWord && (hasMultipleParts || wordCount > 15)) {
      return {
        complexity: 'complex',
        reasoning: 'Contains analytical language and multiple concepts',
        recommendedStrategy: 'planned',
        requiresDecomposition: true,
        estimatedSubQueries: hasMultipleParts ? 3 : 2
      }
    } else if (wordCount > 10 || hasQuestionWord) {
      return {
        complexity: 'moderate',
        reasoning: 'Requires some analysis but focused scope',
        recommendedStrategy: 'direct',
        requiresDecomposition: false
      }
    } else {
      return {
        complexity: 'simple',
        reasoning: 'Direct fact retrieval',
        recommendedStrategy: 'direct',
        requiresDecomposition: false
      }
    }
  }
}
