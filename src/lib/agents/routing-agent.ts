import { azureServiceManager } from '../azure-service-manager'

export type RetrievalStrategy = 'vector' | 'keyword' | 'hybrid'

export interface RoutingDecision {
  strategy: RetrievalStrategy
  reasoning: string
  confidence: number
}

export class RoutingAgent {
  async selectStrategy(query: string): Promise<RoutingDecision> {
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
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

User query: ${query}

Select retrieval strategy as JSON:`

        const response = await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 200, temperature: 0.2, responseFormat: 'json_object' }
        )
        
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0])
        }
      }
    } catch (error) {
      console.warn('Azure routing failed, using fallback:', error)
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
