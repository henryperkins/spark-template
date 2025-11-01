import { azureServiceManager } from '../azure-service-manager'

export type ChunkingStrategy = 'paragraph' | 'sentence' | 'semantic' | 'fixed'

export interface ChunkingDecision {
  strategy: ChunkingStrategy
  chunkSize: number
  overlap: number
  reasoning: string
}

export class DocumentAnalyzerAgent {
  async analyzeDocument(
    fileName: string,
    contentSample: string
  ): Promise<ChunkingDecision> {
    const systemPrompt = `You are a document analysis expert. Analyze documents and recommend optimal chunking strategies.

Strategy types:
- PARAGRAPH: For well-structured documents with clear paragraphs (articles, reports)
- SENTENCE: For dense technical documents where precision matters
- SEMANTIC: For documents with varying section lengths (books, manuals)
- FIXED: For uniform content (logs, data dumps)

Chunk size guidelines:
- Small (500-800 chars): Technical docs, code, precise Q&A
- Medium (800-1200 chars): Articles, general documents
- Large (1200-2000 chars): Books, long-form content

Overlap: 10-20% for context preservation

Respond with JSON:
{
  "strategy": "paragraph" | "sentence" | "semantic" | "fixed",
  "chunkSize": number,
  "overlap": number,
  "reasoning": "why this approach"
}`

    try {
      if (azureServiceManager.isConfigured()) {
        const prompt = (window as any).spark.llmPrompt`${systemPrompt}

File name: ${fileName}

Content sample (first 500 characters):
${contentSample}

Recommend chunking strategy as JSON:`

        const response = await azureServiceManager['openaiService']!.generateCompletion(
          prompt,
          { maxTokens: 300, temperature: 0.4, responseFormat: 'json_object' }
        )
        
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0])
        }
      }
    } catch (error) {
      console.warn('Document analysis failed, using fallback:', error)
    }

    return this.fallbackAnalysis(fileName, contentSample)
  }

  private fallbackAnalysis(fileName: string, contentSample: string): ChunkingDecision {
    const hasCodeMarkers = /```|function|class|import|export/.test(contentSample)
    const avgSentenceLength = contentSample.split(/[.!?]+/).reduce(
      (acc, sent) => acc + sent.length,
      0
    ) / Math.max(contentSample.split(/[.!?]+/).length, 1)
    
    const hasClearParagraphs = contentSample.split(/\n\s*\n/).length > 3
    
    if (hasCodeMarkers) {
      return {
        strategy: 'fixed',
        chunkSize: 600,
        overlap: 50,
        reasoning: 'Technical content detected, using fixed chunking'
      }
    } else if (hasClearParagraphs) {
      return {
        strategy: 'paragraph',
        chunkSize: 1000,
        overlap: 100,
        reasoning: 'Well-structured content with clear paragraphs'
      }
    } else if (avgSentenceLength > 100) {
      return {
        strategy: 'sentence',
        chunkSize: 800,
        overlap: 80,
        reasoning: 'Long sentences detected, using sentence-based chunking'
      }
    } else {
      return {
        strategy: 'semantic',
        chunkSize: 1000,
        overlap: 100,
        reasoning: 'General content, using semantic chunking'
      }
    }
  }
}
