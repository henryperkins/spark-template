import { Source } from '@/types'
import { llmService } from '../services/llm-service'

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

  async refineResponse(
    query: string,
    initialResponse: string,
    initialSources: Source[],
    validationIssues: string[]
  ): Promise<ReActResult> {
    const steps: ReActStep[] = []
    let currentResponse = initialResponse
    let iteration = 0

    if (validationIssues.length === 0) {
      return {
        finalResponse: initialResponse,
        steps: [],
        iterations: 0,
        improved: false
      }
    }

    while (iteration < this.maxIterations && validationIssues.length > 0) {
      iteration++

      const thought = await this.generateThought(
        query,
        currentResponse,
        validationIssues,
        iteration
      )

      const action = this.determineAction(iteration, validationIssues)

      if (action === 'refine') {
        const refinedResponse = await this.refineWithIssues(
          query,
          currentResponse,
          validationIssues,
          initialSources
        )
        
        steps.push({
          thought,
          action,
          observation: 'Response refined based on identified issues',
          iteration
        })

        currentResponse = refinedResponse
        break
      } else if (action === 'complete') {
        steps.push({
          thought,
          action,
          observation: 'Refinement complete after iterative improvement',
          iteration
        })
        break
      }
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

Query: ${query}
Current response: ${currentResponse}

What should be the next step?`

      return await llmService.generateText(prompt, {
        maxTokens: 150,
        temperature: 0.6
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
    sources: Source[]
  ): Promise<string> {
    const contextSnippets = sources
      .map((s, i) => `[${i + 1}] ${s.content}`)
      .join('\n\n')

    const systemPrompt = `You are refining an AI response based on validation feedback.

Issues to address:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Guidelines:
- Fix the identified issues
- Maintain accuracy to source documents
- Add proper citations using [1], [2], etc.
- Keep the response focused on the query

Source documents:
${contextSnippets}`

    try {
      const prompt = (window as any).spark.llmPrompt`${systemPrompt}

User query: ${query}

Current response:
${currentResponse}

Provide an improved response that addresses the issues:`

      return await llmService.generateText(prompt, {
        maxTokens: 800,
        temperature: 0.7
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
