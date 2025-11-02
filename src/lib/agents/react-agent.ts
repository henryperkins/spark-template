import { Source } from '@/types'
import { llmService } from '../services/llm-service'
import { appConfig } from '../config'
import { truncateContext, sanitizeQueryForPrompt } from '../prompt-utils'
import { CriticAgent } from './critic-agent'

export interface ReActStep {
  thought: string
  action: 'retrieve' | 'refine' | 'validate' | 'complete'
  observation: string
  iteration: number
}

export interface ReActResult {
  finalResponse: string
  steps: ReActStep[]
  iterations: number
  improved: boolean
}

export class ReActAgent {
  private maxIterations = 3
  private criticAgent = new CriticAgent()

  async refineResponse(
    query: string,
    initialResponse: string,
    initialSources: Source[],
    validationIssues: string[]
  ): Promise<ReActResult> {
    const steps: ReActStep[] = []
    let currentResponse = initialResponse
    let iteration = 0
    let issues = [...validationIssues]

    if (validationIssues.length === 0) {
      return {
        finalResponse: initialResponse,
        steps: [],
        iterations: 0,
        improved: false
      }
    }

    while (iteration < this.maxIterations && issues.length > 0) {
      iteration++

      const thought = await this.generateThought(
        query,
        currentResponse,
        issues,
        iteration
      )

      const action = this.determineAction(iteration, issues)

      if (action === 'complete') {
        steps.push({
          thought,
          action,
          observation: 'Refinement complete - no further actionable issues',
          iteration
        })
        break
      }

      const refinedResponse = await this.refineWithIssues(
        query,
        currentResponse,
        issues,
        initialSources,
        thought
      )

      // Validate improvement
      let newIssues = issues
      let improved = false
      try {
        const validation = await this.criticAgent.validateResponse(
          query,
          refinedResponse,
          initialSources
        )
        newIssues = validation.issues || []
        improved = validation.isValid || newIssues.length < issues.length
        steps.push({
          thought,
          action,
          observation: improved
            ? `Refined response; issues reduced from ${issues.length} to ${newIssues.length}`
            : 'Refined response; no measurable improvement',
          iteration
        })
      } catch {
        // If critic fails, accept single refinement and exit
        steps.push({
          thought,
          action,
          observation: 'Refined response; validation unavailable',
          iteration
        })
        currentResponse = refinedResponse
        break
      }

      currentResponse = refinedResponse
      if (!improved || newIssues.length === 0) {
        break
      }
      issues = newIssues
    }

    return {
      finalResponse: currentResponse,
      steps,
      iterations: iteration,
      improved: steps.length > 0
    }
  }

  private async generateThought(
    query: string,
    currentResponse: string,
    issues: string[],
    iteration: number
  ): Promise<string> {
    const systemPrompt = `You are analyzing a response to improve it. Think step-by-step about what needs fixing.

Issues identified: ${issues.join(', ')}
Iteration: ${iteration}

Provide a brief thought about the next improvement step.`

    try {
      const prompt = (window as any).spark.llmPrompt`${systemPrompt}

Query: ${sanitizeQueryForPrompt(query)}
Current response: ${currentResponse}

What should be the next step?`

      return await llmService.generateText(prompt, {
        maxTokens: appConfig.truncation.reactThoughtMaxTokens,
        temperature: appConfig.temps.reactThought
      })
    } catch (error) {
      console.warn('Thought generation failed:', error)
    }

    return `Iteration ${iteration}: Addressing ${issues[0]}`
  }

  private determineAction(
    iteration: number,
    issues: string[]
  ): ReActStep['action'] {
    if (iteration >= this.maxIterations) {
      return 'complete'
    }

    if (issues.some(i => i.includes('source') || i.includes('citation'))) {
      return 'refine'
    }

    if (issues.length > 2) {
      return 'refine'
    }

    return 'complete'
  }

  private async refineWithIssues(
    query: string,
    currentResponse: string,
    issues: string[],
    sources: Source[],
    thought?: string
  ): Promise<string> {
    const limitedSources = [...sources]
      .sort((a, b) => (b.azureScore ?? b.relevanceScore) - (a.azureScore ?? a.relevanceScore))
      .slice(0, appConfig.critic.maxSources)
    const rawContext = limitedSources.map((s, i) => `[${i + 1}] ${s.content}`).join('\n\n')
    const contextSnippets = truncateContext(rawContext, appConfig.truncation.reactRefineMaxTokens, {
      notice: '[Context truncated for refinement]'
    })

    const systemPrompt = `You are refining an AI response based on validation feedback.

Issues to address:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Refinement rules:
- Fix ONLY the sentences/claims that correspond to the listed issues.
- Keep correct portions unchanged; do not rewrite the whole response.
- Ensure every factual claim is supported by the provided sources.
- Add citations like [1], [2] immediately after claims they support.
- Maintain coherence and original tone; keep it concise and faithful to sources.
- Output ONLY the refined response text. Do not include analysis or pre/post text.

Citation format example:
"Embeddings are vector representations [1]. They enable semantic search [2]."

Source documents:
${contextSnippets}`

    try {
      const prompt = (window as any).spark.llmPrompt`${systemPrompt}

Refinement plan:
${thought ?? '(none provided)'}

User query: ${sanitizeQueryForPrompt(query)}

Current response:
${currentResponse}

Return only the improved response text (no analysis):`

      return await llmService.generateText(prompt, {
        maxTokens: appConfig.truncation.reactRefineMaxTokens,
        temperature: appConfig.temps.reactRefine
      })
    } catch (error) {
      console.warn('Refinement failed:', error)
    }

    return this.buildFallbackCitedResponse(currentResponse, sources)
  }

  private buildFallbackCitedResponse(
    response: string,
    sources: Source[]
  ): string {
    if (sources.length === 0) {
      return response
    }

    const sanitizedResponse = response
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!sanitizedResponse) {
      return response
    }

    const sentences = sanitizedResponse
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .filter(Boolean)

    if (sentences.length === 0) {
      const sourceList = this.formatSourceList(sources)
      return `${sanitizedResponse} [1]\n\nSources:\n${sourceList}`
    }

    const sourceTokenSets = sources.map(source => this.tokenizeContent(source.content))

    const citedSentences = sentences.map(sentence => {
      const sourceIndex = this.chooseSourceIndex(sentence, sourceTokenSets)
      return `${sentence} [${sourceIndex + 1}]`
    })

    const sourceList = this.formatSourceList(sources)
    return `${citedSentences.join(' ')}\n\nSources:\n${sourceList}`
  }

  private formatSourceList(sources: Source[]): string {
    return sources
      .map((source, idx) => {
        const summary = (source.semanticCaption || source.content || '')
          .replace(/\s+/g, ' ')
          .slice(0, 140)
          .trim()

        const trailingEllipsis =
          summary.length === 140 || summary.endsWith('.')
            ? ''
            : '...'

        return `[${idx + 1}] ${source.documentName}${summary ? ` — ${summary}${trailingEllipsis}` : ''}`
      })
      .join('\n')
  }

  private tokenizeContent(content: string): Set<string> {
    return new Set(
      (content || '')
        .toLowerCase()
        .split(/\W+/)
        .filter(token => token.length >= 4)
    )
  }

  private chooseSourceIndex(
    sentence: string,
    sourceTokenSets: Array<Set<string>>
  ): number {
    if (sourceTokenSets.length === 0) {
      return 0
    }

    const tokens = sentence
      .toLowerCase()
      .split(/\W+/)
      .filter(token => token.length >= 4)

    if (tokens.length === 0) {
      return 0
    }

    let bestIndex = 0
    let bestScore = -1

    sourceTokenSets.forEach((tokenSet, index) => {
      let score = 0
      for (const token of tokens) {
        if (tokenSet.has(token)) {
          score++
        }
      }

      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    })

    return bestScore > 0 ? bestIndex : 0
  }
}
