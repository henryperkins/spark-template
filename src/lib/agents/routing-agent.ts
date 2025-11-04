import { z } from 'zod'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'

export type RetrievalStrategy = 'vector' | 'keyword' | 'hybrid'

export interface RoutingDecision {
  strategy: RetrievalStrategy
  reasoning: string
  confidence: number
}

const routingDecisionSchema: z.ZodType<RoutingDecision> = z.object({
  strategy: z.enum(['vector', 'keyword', 'hybrid']),
  reasoning: z.string().min(5),
  confidence: z.number().min(0).max(1)
})

export class RoutingAgent {
  async selectStrategy(query: string, kb?: { totalDocuments?: number }): Promise<RoutingDecision> {
    const systemPrompt = `You are a retrieval strategy expert. Analyze queries and select the best search approach.

Strategy guidelines:
- VECTOR: Conceptual queries, semantic understanding needed, paraphrased questions
- KEYWORD: Exact term matching needed, technical jargon, specific names/codes
- HYBRID: Mix of concepts and specific terms, best for most queries

Respond with JSON:
{
  "strategy": "vector" | "keyword" | "hybrid",
  "reasoning": "why this strategy fits",
  "confidence": 0.0-1.0
}`

    try {
      const prompt = `${systemPrompt}
${JSON_OUTPUT_REQUIREMENTS}
${kb?.totalDocuments !== undefined ? `Knowledge base: Total documents: ${kb.totalDocuments}` : ''}

User query: ${sanitizeQueryForPrompt(query)}

Select retrieval strategy as JSON:`

      return await llmService.generateJson(prompt, routingDecisionSchema, {
        maxTokens: appConfig.truncation.routerMaxTokens,
        temperature: appConfig.temps.router
      })
    } catch (error) {
      console.warn('LLM routing failed, using fallback:', error)
    }

    return this.fallbackRouting(query)
  }

  private fallbackRouting(query: string): RoutingDecision {
    const lowerQuery = query.toLowerCase()

    const hasQuotes = /["']/.test(query)
    const hasCodes = /[A-Z]{2,}[0-9]|[0-9]{3,}/.test(query)
    const technicalTerms = ['api', 'code', 'function', 'class', 'method', 'error', 'id', 'key']
    const hasTechnical = technicalTerms.some(term => lowerQuery.includes(term))

    const conceptualWords = ['how', 'why', 'explain', 'understand', 'concept', 'idea', 'meaning']
    const isConceptual = conceptualWords.some(word => lowerQuery.includes(word))

    if (hasQuotes || (hasCodes && hasTechnical)) {
      return {
        strategy: 'keyword',
        reasoning: 'Query contains exact terms or technical identifiers',
        confidence: 0.8
      }
    } else if (isConceptual && !hasTechnical) {
      return {
        strategy: 'vector',
        reasoning: 'Conceptual query requiring semantic understanding',
        confidence: 0.75
      }
    } else {
      return {
        strategy: 'hybrid',
        reasoning: 'Balanced approach for mixed query type',
        confidence: 0.9
      }
    }
  }
}
