import { z } from 'zod'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'
import type { KBContext } from './agent-context'

export type QueryComplexity = 'simple' | 'moderate' | 'complex'

const queryClassificationSchema = z.object({
  complexity: z.enum(['simple', 'moderate', 'complex']),
  reasoning: z.string().min(5),
  recommendedStrategy: z.enum(['direct', 'planned', 'iterative']),
  requiresDecomposition: z.boolean(),
  estimatedSubQueries: z.number().int().min(1).max(6).optional()
})

export type QueryClassification = z.infer<typeof queryClassificationSchema>

export class QueryClassifierAgent {
  /**
   * Classify query complexity with optional KB-aware context.
   * When KB context is provided, classification considers the knowledge base's
   * size, content types, and topic coverage.
   */
  async classifyQuery(query: string, kb?: KBContext): Promise<QueryClassification> {
    // Build KB-aware context for prompt if available
    let kbContext = ''
    if (kb) {
      kbContext = `

Knowledge Base Context:
- Documents: ${kb.documentCount} documents with ${kb.chunkCount} chunks
- Embedding coverage: ${(kb.embeddingCoverage * 100).toFixed(0)}%
- Content type: ${kb.contentTypes.code > 0.5 ? 'primarily code' : kb.contentTypes.technical > 0.5 ? 'primarily technical docs' : 'primarily prose'}
${kb.topics && kb.topics.length > 0 ? `- Main topics: ${kb.topics.slice(0, 5).join(', ')}` : ''}

When classifying, consider whether the query scope matches the KB's coverage.`
    }

    const systemPrompt = `You are a query classification expert. Analyze the user's query and determine its complexity.

Classification criteria:
- SIMPLE: Single fact retrieval, specific information lookup, yes/no questions${kb ? ', query scope is narrow relative to KB size' : ''}
- MODERATE: Requires comparing 2-3 concepts, summarization of a topic, questions with some analysis${kb ? ', query scope spans multiple documents' : ''}
- COMPLEX: Multi-faceted questions, requires synthesis from multiple sources, comparative analysis across many items, "how" and "why" questions requiring reasoning${kb ? ', query scope requires deep KB traversal' : ''}
${kbContext}

Respond with a JSON object containing:
- complexity: "simple" | "moderate" | "complex"
- reasoning: Brief explanation of classification (consider KB context if provided)
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
      const prompt = `${systemPrompt}
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
