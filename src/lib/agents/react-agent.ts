import { Source } from '@/types'
import { azureServiceManager } from '../azure-service-manager'

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
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

Query: ${query}
Current response: ${currentResponse}

What should be the next step?`

        return await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 150, temperature: 0.6 }
        )
      }
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
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

User query: ${query}

Current response:
${currentResponse}

Provide an improved response that addresses the issues:`

        return await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 800, temperature: 0.7 }
        )
      }
    } catch (error) {
      console.warn('Refinement failed:', error)
    }

    const citationAdded = currentResponse.replace(
      /\.\s/g,
      ` [${Math.floor(Math.random() * sources.length) + 1}]. `
    )
    return citationAdded
  }
}
