import { azureServiceManager } from '../azure-service-manager'

export type QueryComplexity = 'simple' | 'moderate' | 'complex'

export interface QueryClassification {
  complexity: QueryComplexity
  reasoning: string
  recommendedStrategy: 'direct' | 'planned' | 'iterative'
  requiresDecomposition: boolean
  estimatedSubQueries?: number
}

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
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

User query: ${query}

Provide your classification as a JSON object:`

        const response = await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 300, temperature: 0.3, responseFormat: 'json_object' }
        )
        
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0])
        }
      }
    } catch (error) {
      console.warn('Azure classification failed, using fallback:', error)
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
