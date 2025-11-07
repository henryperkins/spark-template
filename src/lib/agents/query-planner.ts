import { z } from 'zod'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { sanitizeQueryForPrompt, JSON_OUTPUT_REQUIREMENTS } from '../prompt-utils'
import type { KBContext } from './agent-context'

export interface SubQuery {
  id: string
  query: string
  purpose: string
  priority: number
}

export interface QueryPlan {
  originalQuery: string
  subQueries: SubQuery[]
  executionStrategy: 'sequential' | 'parallel'
  reasoning: string
}

const subQuerySchema: z.ZodType<SubQuery> = z.object({
  id: z.string().min(1),
  query: z.string().min(3),
  purpose: z.string().min(3),
  priority: z.number().int().min(1).max(10)
})

const planSchema = z.object({
  subQueries: z.array(subQuerySchema).min(1).max(6),
  executionStrategy: z.enum(['sequential', 'parallel']),
  reasoning: z.string().min(5)
})

export class QueryPlannerAgent {
  /**
   * Create query plan with KB-aware decomposition.
   * When KB context is provided, biases sub-queries toward KB topics and
   * considers document coverage for better decomposition.
   */
  async createPlan(query: string, estimatedSubQueries: number = 2, kb?: KBContext): Promise<QueryPlan> {
    // Build KB-aware context for prompt if available
    let kbContext = ''
    if (kb) {
      kbContext = `

Knowledge Base Context:
- Documents: ${kb.documentCount} documents with ${kb.chunkCount} chunks
${kb.topics && kb.topics.length > 0 ? `- Main topics covered: ${kb.topics.slice(0, 8).join(', ')}` : ''}
- Content type: ${kb.contentTypes.code > 0.5 ? 'code-heavy' : kb.contentTypes.technical > 0.5 ? 'technical documentation' : 'prose/documentation'}

When decomposing:
- Bias sub-queries toward topics that exist in the KB
- If KB is small (< 5 docs), prefer fewer, broader sub-queries
- If KB is large (> 20 docs), more specific sub-queries are appropriate
- Consider whether KB likely contains information for each sub-query`
    }

    const systemPrompt = `You are a query planning expert. Break down complex queries into focused, non-overlapping sub-queries.

Decomposition rules:
- Create 2-5 sub-queries (use ${estimatedSubQueries} as a hint, not a hard limit)
- Each sub-query must be specific and independently answerable from retrieval
- Minimize redundancy; merge overlapping sub-queries
- Order by dependency: prerequisites first; choose "sequential" if dependencies exist, else "parallel"
- Provide a brief "purpose" for each sub-query
${kb && kb.documentCount < 5 ? '- Keep sub-queries broad; small KB may not support narrow queries' : ''}
${kbContext}

Respond with JSON:
{
  "subQueries": [
    {
      "id": "unique-id",
      "query": "focused question",
      "purpose": "what this sub-query retrieves",
      "priority": 1
    }
  ],
  "executionStrategy": "parallel" | "sequential",
  "reasoning": "why this decomposition"
}`

    try {
      const prompt = `${systemPrompt}
${JSON_OUTPUT_REQUIREMENTS}

User query: ${sanitizeQueryForPrompt(query)}

Create a query plan as JSON:`

      const parsed = await llmService.generateJson(prompt, planSchema, {
        maxTokens: appConfig.truncation.plannerMaxTokens,
        temperature: appConfig.temps.planner
      })

      return {
        originalQuery: query,
        ...parsed
      }
    } catch (error) {
      console.warn('LLM query planning failed, using fallback:', error)
    }

    return this.fallbackPlan(query, estimatedSubQueries, kb)
  }

  private fallbackPlan(query: string, count: number, kb?: KBContext): QueryPlan {
    // KB-aware fallback: limit sub-queries for small KBs
    const adjustedCount = kb && kb.documentCount < 5
      ? Math.min(count, 2)
      : count
    const desiredCount = Math.max(adjustedCount, 1)
    const normalizedQuery = query.trim()

    let candidateClauses = this.segmentByPunctuation(normalizedQuery)

    if (candidateClauses.length <= 1) {
      candidateClauses = this.expandCompoundQuery(normalizedQuery)
    }

    if (candidateClauses.length === 0) {
      candidateClauses = [this.ensureQuestionForm(normalizedQuery)]
    }

    const limitedClauses = this.dedupeClauses(candidateClauses).slice(0, desiredCount)

    const subQueries = limitedClauses.map((clause, index) => ({
      id: `sub-${index + 1}`,
      query: clause,
      purpose: this.generatePurpose(clause),
      priority: index + 1
    }))

    return {
      originalQuery: query,
      subQueries,
      executionStrategy: subQueries.length > 1 ? 'parallel' : 'sequential',
      reasoning: this.buildFallbackReasoning(query, subQueries)
    }
  }

  private segmentByPunctuation(query: string): string[] {
    if (!query) {
      return []
    }

    const segments = query
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map(segment => this.ensureQuestionForm(segment))
      .filter(Boolean)

    return segments
  }

  private expandCompoundQuery(query: string): string[] {
    if (!query) {
      return []
    }

    const enumerated = this.extractEnumeratedQueries(query)
    if (enumerated.length > 0) {
      return enumerated
    }

    const comparison = this.extractComparisonQueries(query)
    if (comparison.length > 0) {
      return comparison
    }

    const compoundActions = this.extractCompoundActions(query)
    if (compoundActions.length > 0) {
      return compoundActions
    }

    return [this.ensureQuestionForm(query)]
  }

  private extractEnumeratedQueries(query: string): string[] {
    const listPattern = /^(?<prefix>.+?\b(?:on|in|for|about|regarding|concerning|across|covering)\s)(?<items>.+)$/i
    const match = query.match(listPattern)

    if (!match || !match.groups?.prefix || !match.groups?.items) {
      return []
    }

    const { prefix, items } = match.groups

    if (!/[,;]|(?:\band\b)|(?:\bor\b)/i.test(items)) {
      return []
    }

    const rawItems = items
      .split(/(?:,|;|\band\b|\bor\b)/i)
      .map(item => item.replace(/^\s*(?:the|a|an)\s+/i, '').trim())
      .filter(item => item.length > 2)

    if (rawItems.length < 2) {
      return []
    }

    return rawItems.map(item => this.ensureQuestionForm(`${prefix}${item}`))
  }

  private extractComparisonQueries(query: string): string[] {
    const comparisonPattern = /\bcompare\s+(?<first>.+?)\s+(?:and|with|to|versus|vs\.?)\s+(?<second>[^.?!]+)(?:[.?!]|$)/i
    const match = query.match(comparisonPattern)

    if (!match || !match.groups?.first || !match.groups?.second) {
      return []
    }

    const first = match.groups.first.trim()
    const second = match.groups.second.trim()

    return [
      this.ensureQuestionForm(`What are the key characteristics of ${first}`),
      this.ensureQuestionForm(`What are the key characteristics of ${second}`),
      this.ensureQuestionForm(`How do ${first} and ${second} differ`)
    ]
  }

  private extractCompoundActions(query: string): string[] {
    const parts = query.split(/\s+\band\s+/i).map(part => part.trim()).filter(Boolean)

    if (parts.length <= 1) {
      return []
    }

    const leadingVerb = this.extractLeadingVerb(parts[0]) || 'Explain'

    return parts.map((part, index) => {
      if (index === 0) {
        return this.ensureQuestionForm(part)
      }

      const hasVerb = /^\b(what|why|how|who|when|where|list|explain|describe|compare|summarize|analyze|outline|predict|assess|evaluate|identify|detail|provide|estimate|investigate)\b/i.test(
        part
      )

      const clause = hasVerb ? part : `${leadingVerb} ${part}`
      return this.ensureQuestionForm(clause)
    })
  }

  private ensureQuestionForm(clause: string): string {
    const trimmed = clause.trim().replace(/^[-\d.)(]+\s*/, '')

    if (!trimmed) {
      return ''
    }

    if (/[?]$/.test(trimmed)) {
      return trimmed
    }

    if (/[.!]$/.test(trimmed)) {
      return trimmed
    }

    return `${trimmed}?`
  }

  private extractLeadingVerb(clause: string): string | null {
    const verbs = [
      'explain',
      'describe',
      'list',
      'summarize',
      'analyze',
      'outline',
      'compare',
      'contrast',
      'predict',
      'assess',
      'evaluate',
      'identify',
      'investigate',
      'detail',
      'provide',
      'estimate'
    ]

    const [firstWord] = clause.trim().split(/\s+/)

    if (firstWord && verbs.includes(firstWord.toLowerCase())) {
      return firstWord
    }

    return null
  }

  private dedupeClauses(clauses: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const clause of clauses) {
      const normalized = clause.toLowerCase()
      if (clause && !seen.has(normalized)) {
        seen.add(normalized)
        result.push(clause)
      }
    }

    return result
  }

  private generatePurpose(clause: string): string {
    const firstWord = clause.trim().split(/\s+/)[0]?.toLowerCase() || ''

    switch (firstWord) {
      case 'compare':
        return 'Contrast the key differences'
      case 'how':
      case 'why':
      case 'what':
        return 'Answer the specific sub-question'
      case 'describe':
      case 'explain':
        return 'Provide explanatory context'
      case 'summarize':
        return 'Deliver a concise summary'
      case 'identify':
      case 'list':
        return 'Enumerate relevant items'
      case 'analyze':
      case 'assess':
      case 'evaluate':
        return 'Evaluate contributing factors'
      default:
        return 'Gather supporting evidence'
    }
  }

  private buildFallbackReasoning(_query: string, subQueries: SubQuery[]): string {
    if (subQueries.length <= 1) {
      return 'Fallback plan retained a single coherent query due to limited decomposition signals.'
    }

    return `Fallback plan derived ${subQueries.length} focused sub-queries by splitting the original question into coherent clauses and topic areas.`
  }
}
