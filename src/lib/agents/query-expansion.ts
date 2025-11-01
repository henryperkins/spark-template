import { z } from 'zod'
import { Document, Source } from '@/types'
import { cacheManager } from '@/lib/cache-manager'
import { llmService } from '../services/llm-service'

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

  async expandQuery(
    query: string,
    documents: Document[],
    sources?: Source[]
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
      strategy
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
    const docIds = documents.map(d => d.id).sort().join(',')
    const sourceIds = sources?.map(s => s.chunkId).sort().join(',') || 'none'
    return `query-expansion:${query}:${docIds}:${sourceIds}`
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

    const prompt = (window as any).spark.llmPrompt`Analyze the following document excerpts and identify 5-7 main topics or themes.

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
    strategy: 'document-based' | 'context-based' | 'hybrid'
  ): Promise<SuggestedQuestion[]> {
    const contextContent = sources
      ?.slice(0, 3)
      .map(s => s.content)
      .join('\n\n')
      .substring(0, 2000) || ''

    const topicsText = topics.length > 0 
      ? `\n\nKnowledge base topics: ${topics.join(', ')}` 
      : ''

    let prompt: string

    if (strategy === 'context-based' && contextContent) {
      prompt = (window as any).spark.llmPrompt`Based on the user's question and the retrieved context, suggest 4 related questions the user might want to ask.

User's question: ${query}

Retrieved context:
${contextContent}${topicsText}

Generate questions that:
1. Ask for clarification or more details (category: "clarification")
2. Explore related concepts mentioned in the context (category: "related")
3. Go deeper into specific aspects (category: "deeper")
4. Broaden the scope to related topics (category: "broader")

Return ONLY a JSON object with property "questions" containing an array of objects with: question (string), reasoning (string - why this is relevant), category (one of: clarification, related, deeper, broader), relevanceScore (0-1).

Example: {"questions": [{"question": "What are the prerequisites?", "reasoning": "Context mentions requirements", "category": "clarification", "relevanceScore": 0.9}]}`

    } else if (strategy === 'document-based' && topics.length > 0) {
      prompt = (window as any).spark.llmPrompt`Based on the user's question and the available knowledge base topics, suggest 4 related questions the user might want to explore.

User's question: ${query}

Knowledge base topics: ${topics.join(', ')}

Generate questions that:
1. Ask for clarification about concepts (category: "clarification")
2. Explore related topics from the knowledge base (category: "related")
3. Go deeper into specific areas (category: "deeper")
4. Broaden to connected topics (category: "broader")

Return ONLY a JSON object with property "questions" containing an array of objects with: question (string), reasoning (string - why this is relevant), category (one of: clarification, related, deeper, broader), relevanceScore (0-1).

Example: {"questions": [{"question": "What are the main components?", "reasoning": "Helps understand architecture", "category": "clarification", "relevanceScore": 0.85}]}`

    } else {
      prompt = (window as any).spark.llmPrompt`Based on the user's question, suggest 4 related questions that would help them explore the topic more thoroughly.

User's question: ${query}

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
        maxTokens: 600,
        temperature: 0.4
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
