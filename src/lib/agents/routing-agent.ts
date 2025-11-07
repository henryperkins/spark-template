import { z } from 'zod'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'
import type { KBContext } from './agent-context'

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
  /**
   * Select retrieval strategy with KB-aware context.
   * When KB context is provided, considers content types, embedding availability,
   * and KB size to recommend optimal strategy.
   */
  async selectStrategy(query: string, kb?: KBContext): Promise<RoutingDecision> {
    // Build KB-aware context for prompt if available
    let kbContext = ''
    if (kb) {
      // Determine dominant content type
      const dominantType = kb.contentTypes.code > 0.5 ? 'code-heavy'
        : kb.contentTypes.technical > 0.5 ? 'technical documentation'
        : 'primarily prose/documentation'

      kbContext = `

Knowledge Base Context:
- Documents: ${kb.documentCount} documents with ${kb.chunkCount} chunks
- Content type: ${dominantType}
- Embeddings: ${kb.hasEmbeddings ? `available (${(kb.embeddingCoverage * 100).toFixed(0)}% coverage)` : 'NOT available'}
${kb.topics && kb.topics.length > 0 ? `- Main topics: ${kb.topics.slice(0, 5).join(', ')}` : ''}

Strategy recommendations based on KB:
- If embeddings unavailable or low coverage (<50%), prefer KEYWORD or HYBRID (not pure VECTOR)
- If content is code-heavy (>50%), weight KEYWORD higher for exact matching
- If content is technical docs, HYBRID works well for both concepts and terminology
- If content is prose, VECTOR excels for semantic matching`
    }

    const systemPrompt = `You are a retrieval strategy expert. Analyze queries and select the best search approach.

Strategy guidelines:
- VECTOR: Conceptual queries, semantic understanding needed, paraphrased questions${kb?.hasEmbeddings === false ? ' (NOT available - embeddings missing)' : ''}
- KEYWORD: Exact term matching needed, technical jargon, specific names/codes${kb && kb.contentTypes.code > 0.5 ? ' (recommended for code-heavy KB)' : ''}
- HYBRID: Mix of concepts and specific terms, best for most queries${kb && kb.contentTypes.technical > 0.5 ? ' (ideal for technical documentation)' : ''}
${kbContext}

Respond with JSON:
{
  "strategy": "vector" | "keyword" | "hybrid",
  "reasoning": "why this strategy fits (consider KB characteristics)",
  "confidence": 0.0-1.0
}`

    try {
      const prompt = `${systemPrompt}
${JSON_OUTPUT_REQUIREMENTS}

User query: ${sanitizeQueryForPrompt(query)}

Select retrieval strategy as JSON:`

      return await llmService.generateJson(prompt, routingDecisionSchema, {
        maxTokens: appConfig.truncation.routerMaxTokens,
        temperature: appConfig.temps.router
      })
    } catch (error) {
      console.warn('LLM routing failed, using fallback:', error)
    }

    return this.fallbackRouting(query, kb)
  }

  private fallbackRouting(query: string, kb?: KBContext): RoutingDecision {
    const lowerQuery = query.toLowerCase()

    const hasQuotes = /["']/.test(query)
    const hasCodes = /[A-Z]{2,}[0-9]|[0-9]{3,}/.test(query)
    const technicalTerms = ['api', 'code', 'function', 'class', 'method', 'error', 'id', 'key']
    const hasTechnical = technicalTerms.some(term => lowerQuery.includes(term))

    const conceptualWords = ['how', 'why', 'explain', 'understand', 'concept', 'idea', 'meaning']
    const isConceptual = conceptualWords.some(word => lowerQuery.includes(word))

    // KB-aware fallback logic
    const hasEmbeddings = kb?.hasEmbeddings ?? true
    const embeddingCoverage = kb?.embeddingCoverage ?? 1.0
    const isCodeHeavy = kb && kb.contentTypes.code > 0.5
    const isTechnicalDocs = kb && kb.contentTypes.technical > 0.5

    // If embeddings unavailable or low coverage, avoid pure vector
    if (!hasEmbeddings || embeddingCoverage < 0.5) {
      if (hasQuotes || hasCodes || hasTechnical) {
        return {
          strategy: 'keyword',
          reasoning: 'Exact matching needed; embeddings unavailable/low coverage',
          confidence: 0.85
        }
      }
      return {
        strategy: 'hybrid',
        reasoning: 'Balanced approach; embeddings unavailable/low coverage',
        confidence: 0.8
      }
    }

    // Code-heavy KB → prefer keyword for exact matching
    if (isCodeHeavy && (hasCodes || hasTechnical)) {
      return {
        strategy: 'keyword',
        reasoning: 'Code-heavy KB benefits from exact term matching',
        confidence: 0.85
      }
    }

    // Standard heuristics
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
      // Technical docs KB → hybrid is ideal
      const confidence = isTechnicalDocs ? 0.95 : 0.9
      return {
        strategy: 'hybrid',
        reasoning: isTechnicalDocs
          ? 'Balanced approach ideal for technical documentation'
          : 'Balanced approach for mixed query type',
        confidence
      }
    }
  }
}
