import { z } from 'zod'
import { Document, Source } from '@/types'
import { cacheManager } from '@/lib/cache-manager'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { truncateContext, sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'
import type { KBContext } from './agent-context'

export interface SuggestedQuestion {
  question: string
  reasoning: string
  category: 'clarification' | 'related' | 'deeper' | 'broader'
  relevanceScore: number
}

export interface QueryExpansion {
  originalQuery: string
  suggestedQuestions: SuggestedQuestion[]
  documentTopics: string[]
  expansionStrategy: 'document-based' | 'context-based' | 'hybrid'
  cached?: boolean
}

const topicsSchema = z.object({
  topics: z.array(z.string().min(2)).min(1).max(10)
})

const suggestedQuestionSchema: z.ZodType<SuggestedQuestion> = z.object({
  question: z.string().min(5),
  reasoning: z.string().min(5),
  category: z.enum(['clarification', 'related', 'deeper', 'broader']),
  relevanceScore: z.number().min(0).max(1)
})

const suggestionResponseSchema = z.object({
  questions: z.array(suggestedQuestionSchema).min(1).max(6)
})

export class QueryExpansionAgent {
  private readonly CACHE_TTL = 30 * 60 * 1000

  /**
   * Expand query with KB and content-type awareness.
   * When KB context is provided, tailors suggestions based on content type
   * (code-heavy KBs get more technical questions, etc.).
   */
  async expandQuery(
    query: string,
    documents: Document[],
    sources?: Source[],
    kb?: KBContext
  ): Promise<QueryExpansion> {
    const cacheKey = this.buildCacheKey(query, documents, sources)

    const cached = await cacheManager.get<QueryExpansion>(cacheKey)
    if (cached) {
      return { ...cached, cached: true }
    }

    const documentTopics = await this.extractDocumentTopics(documents)

    const strategy = sources && sources.length > 0
      ? 'context-based'
      : documents.length > 0
        ? 'document-based'
        : 'hybrid'

    const suggestedQuestions = await this.generateSuggestions(
      query,
      documents,
      sources,
      documentTopics,
      strategy,
      kb
    )

    const expansion: QueryExpansion = {
      originalQuery: query,
      suggestedQuestions,
      documentTopics,
      expansionStrategy: strategy,
      cached: false
    }

    await cacheManager.set(cacheKey, expansion, this.CACHE_TTL)

    return expansion
  }

  private buildCacheKey(query: string, documents: Document[], sources?: Source[]): string {
    // Cloudflare KV keys are limited to 512 bytes; long queries + many IDs can exceed this.
    // To stay safe and deterministic, hash the inputs into a compact suffix.
    const docIds = documents.map(d => d.id).sort().join(',')
    const sourceIds = sources?.map(s => s.chunkId).sort().join(',') || 'none'
    const raw = `${query}::${docIds}::${sourceIds}`

    // FNV-1a 64-bit hash with 64-bit modular reduction at each step.
    // Without masking, BigInt would grow unbounded and produce overlong keys.
    const FNV_OFFSET = 0xcbf29ce484222325n
    const FNV_PRIME = 0x100000001b3n
    const MASK64 = 0xffffffffffffffffn
    let hash = FNV_OFFSET
    for (let i = 0; i < raw.length; i++) {
      hash ^= BigInt(raw.charCodeAt(i))
      hash = (hash * FNV_PRIME) & MASK64
    }
    const hex = hash.toString(16).padStart(16, '0')
    return `query-expansion:${hex}`
  }

  private async extractDocumentTopics(documents: Document[]): Promise<string[]> {
    if (documents.length === 0) {
      return []
    }

    const sampleChunks = documents
      .flatMap(doc => doc.chunks.slice(0, 3))
      .slice(0, 10)

    if (sampleChunks.length === 0) {
      return []
    }

    const content = sampleChunks
      .map(chunk => chunk.content)
      .join('\n\n')
      .substring(0, 3000)

    const prompt = `Analyze the following document excerpts and identify 5-7 main topics or themes.

Document excerpts:
${content}

Return ONLY a JSON object with a single property "topics" containing an array of topic strings.
Example: {"topics": ["machine learning", "data processing", "model training"]}`

    try {
      const result = await llmService.generateJson(prompt, topicsSchema, {
        maxTokens: 400,
        temperature: 0.2
      })
      return result.topics
    } catch (error) {
      console.error('Failed to extract topics:', error)
      return []
    }
  }

  private async generateSuggestions(
    query: string,
    documents: Document[],
    sources: Source[] | undefined,
    topics: string[],
    strategy: 'document-based' | 'context-based' | 'hybrid',
    kb?: KBContext
  ): Promise<SuggestedQuestion[]> {
    // Build KB-aware context for prompts
    let kbGuidance = ''
    if (kb) {
      const contentType = kb.contentTypes.code > 0.5 ? 'code-focused'
        : kb.contentTypes.technical > 0.5 ? 'technical'
        : 'general documentation'

      kbGuidance = `\n\nKnowledge Base: ${contentType} content. Tailor suggestions accordingly.`

      if (kb.contentTypes.code > 0.5) {
        kbGuidance += '\n- Include questions about implementation, APIs, code examples'
      } else if (kb.contentTypes.technical > 0.5) {
        kbGuidance += '\n- Include questions about technical specifications, configurations, architecture'
      } else {
        kbGuidance += '\n- Include conceptual questions and practical applications'
      }
    }
    const rawContext = sources
      ?.slice(0, 3)
      .map(s => s.content)
      .join('\n\n') || ''

    const contextContent = truncateContext(rawContext, appConfig.truncation.expansionMaxTokens, {
      notice: '[Context truncated for expansion]'
    })

    const topicsText = topics.length > 0
      ? `\n\nKnowledge base topics: ${topics.join(', ')}`
      : ''

    let prompt: string

    if (strategy === 'context-based' && contextContent) {
      prompt = `Based on the user's question and the retrieved context, suggest 4 related questions the user might want to ask.
${JSON_OUTPUT_REQUIREMENTS}

User's question: ${sanitizeQueryForPrompt(query)}

Retrieved context:
${contextContent}${topicsText}${kbGuidance}

Generate questions that:
1. Ask for clarification or more details (category: "clarification")
2. Explore related concepts mentioned in the context (category: "related")
3. Go deeper into specific aspects (category: "deeper")
4. Broaden the scope to related topics (category: "broader")

Return ONLY a JSON object with property "questions" containing an array of objects with: question (string), reasoning (string - why this is relevant), category (one of: clarification, related, deeper, broader), relevanceScore (0-1).

Example: {"questions": [{"question": "What are the prerequisites?", "reasoning": "Context mentions requirements", "category": "clarification", "relevanceScore": 0.9}]}`

    } else if (strategy === 'document-based' && topics.length > 0) {
      prompt = `Based on the user's question and the available knowledge base topics, suggest 4 related questions the user might want to explore.
${JSON_OUTPUT_REQUIREMENTS}

User's question: ${sanitizeQueryForPrompt(query)}

Knowledge base topics: ${topics.join(', ')}${kbGuidance}

Generate questions that:
1. Ask for clarification about concepts (category: "clarification")
2. Explore related topics from the knowledge base (category: "related")
3. Go deeper into specific areas (category: "deeper")
4. Broaden to connected topics (category: "broader")

Return ONLY a JSON object with property "questions" containing an array of objects with: question (string), reasoning (string - why this is relevant), category (one of: clarification, related, deeper, broader), relevanceScore (0-1).

Example: {"questions": [{"question": "What are the main components?", "reasoning": "Helps understand architecture", "category": "clarification", "relevanceScore": 0.85}]}`

    } else {
      prompt = `Based on the user's question, suggest 4 related questions that would help them explore the topic more thoroughly.
${JSON_OUTPUT_REQUIREMENTS}

User's question: ${sanitizeQueryForPrompt(query)}${kbGuidance}

Generate questions that:
1. Ask for clarification (category: "clarification")
2. Explore related concepts (category: "related")
3. Go deeper into details (category: "deeper")
4. Broaden the perspective (category: "broader")

Return ONLY a JSON object with property "questions" containing an array of objects with: question (string), reasoning (string - why this is relevant), category (one of: clarification, related, deeper, broader), relevanceScore (0-1).

Example: {"questions": [{"question": "Can you explain this in simpler terms?", "reasoning": "Helps understand complex topic", "category": "clarification", "relevanceScore": 0.8}]}`
    }

    try {
      const result = await llmService.generateJson(prompt, suggestionResponseSchema, {
        maxTokens: appConfig.truncation.expansionMaxTokens,
        temperature: appConfig.temps.expansion
      })
      return result.questions
    } catch (error) {
      console.error('Failed to generate suggestions:', error)
      return this.getFallbackSuggestions(query)
    }
  }

  private getFallbackSuggestions(query: string): SuggestedQuestion[] {
    return [
      {
        question: `Can you provide more details about ${query}?`,
        reasoning: 'Clarifies the original query',
        category: 'clarification',
        relevanceScore: 0.7
      },
      {
        question: `What are the key concepts related to ${query}?`,
        reasoning: 'Explores related topics',
        category: 'related',
        relevanceScore: 0.7
      },
      {
        question: `What are some examples of ${query}?`,
        reasoning: 'Provides concrete understanding',
        category: 'deeper',
        relevanceScore: 0.7
      },
      {
        question: `How does ${query} fit into the broader context?`,
        reasoning: 'Expands perspective',
        category: 'broader',
        relevanceScore: 0.7
      }
    ]
  }
}
