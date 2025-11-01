import { azureServiceManager } from '../azure-service-manager'

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

export class QueryPlannerAgent {
  async createPlan(query: string, estimatedSubQueries: number = 2): Promise<QueryPlan> {
    const systemPrompt = `You are a query planning expert. Break down complex queries into focused sub-queries.

Guidelines:
- Create ${estimatedSubQueries} sub-queries that cover different aspects
- Each sub-query should be specific and focused
- Sub-queries should be answerable from document retrieval
- Avoid redundancy between sub-queries
- Prioritize sub-queries (1 = highest priority)

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
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

User query: ${query}

Create a query plan as JSON:`

        const response = await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 500, temperature: 0.4, responseFormat: 'json_object' }
        )
        
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return {
            originalQuery: query,
            ...parsed
          }
        }
      }
    } catch (error) {
      console.warn('Azure planning failed, using fallback:', error)
    }

    return this.fallbackPlan(query, estimatedSubQueries)
  }

  private fallbackPlan(query: string, count: number): QueryPlan {
    const words = query.split(/\s+/)
    const midpoint = Math.floor(words.length / 2)
    
    const subQueries: SubQuery[] = []
    
    if (count >= 2) {
      subQueries.push({
        id: 'sub-1',
        query: words.slice(0, midpoint).join(' '),
        purpose: 'First part of the question',
        priority: 1
      })
      subQueries.push({
        id: 'sub-2',
        query: words.slice(midpoint).join(' '),
        purpose: 'Second part of the question',
        priority: 2
      })
    } else {
      subQueries.push({
        id: 'sub-1',
        query: query,
        purpose: 'Complete question',
        priority: 1
      })
    }

    return {
      originalQuery: query,
      subQueries,
      executionStrategy: 'parallel',
      reasoning: 'Fallback decomposition based on query structure'
    }
  }
}
