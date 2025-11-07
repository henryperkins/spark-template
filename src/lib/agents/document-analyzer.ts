import { z } from 'zod'
import { cacheManager } from '../cache-manager'
import { llmService } from '../services/llm-service'

export type ChunkingStrategy = 'paragraph' | 'sentence' | 'semantic' | 'fixed'

export interface ChunkingDecision {
  strategy: ChunkingStrategy
  chunkSize: number
  overlap: number
  reasoning: string
}

const chunkingDecisionSchema: z.ZodType<ChunkingDecision> = z.object({
  strategy: z.enum(['paragraph', 'sentence', 'semantic', 'fixed']),
  chunkSize: z.number().int().min(200).max(4000),
  overlap: z.number().int().min(0).max(800),
  reasoning: z.string().min(5)
})

export class DocumentAnalyzerAgent {
  private readonly CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

  async analyzeDocument(
    fileName: string,
    contentSample: string
  ): Promise<ChunkingDecision> {
    const cacheKey = `doc-analysis:${fileName}`
    const contentHash = await this.computeContentHash(contentSample)

    const hasSemanticDrift = await cacheManager.checkSemanticDrift(
      cacheKey,
      contentHash,
      0.95
    )

    if (!hasSemanticDrift) {
      const cached = await cacheManager.get<ChunkingDecision>(cacheKey)
      if (cached) {
        return cached
      }
    }

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

    let decision: ChunkingDecision | null = null

    try {
      const prompt = `${systemPrompt}

File name: ${fileName}

Content sample (first 500 characters):
${contentSample}

Recommend chunking strategy as JSON:`

      decision = await llmService.generateJson(prompt, chunkingDecisionSchema, {
        maxTokens: 300,
        temperature: 0.4
      })
    } catch (error) {
      console.warn('Document analysis failed, using fallback:', error)
    }

    if (!decision) {
      decision = this.fallbackAnalysis(fileName, contentSample)
    }

    await this.cacheDecision(cacheKey, decision, contentHash)
    return decision
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

  private async computeContentHash(content: string): Promise<string> {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(content)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } catch {
      return this.simpleHashFallback(content)
    }
  }

  private simpleHashFallback(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i)
      hash |= 0
    }
    return hash.toString(16)
  }

  private async cacheDecision(
    cacheKey: string,
    decision: ChunkingDecision,
    contentHash: string
  ): Promise<void> {
    try {
      await cacheManager.setWithSemanticHash(
        cacheKey,
        decision,
        contentHash,
        this.CACHE_TTL_MS
      )
    } catch (error) {
      console.warn(
        'Failed to store document analysis result in cache:',
        error
      )
    }
  }
}

// --- Content type classification helpers (ingestion/KB analysis) ---
export type ContentTypeBreakdown = {
  code: number
  prose: number
  technical: number
}

/**
 * Classify content types for a set of chunk texts using lightweight heuristics.
 * Returns normalized percentages (0-1) for { code, prose, technical }.
 */
export function classifyContentTypesForChunks(chunks: string[]): ContentTypeBreakdown {
  if (!chunks || chunks.length === 0) {
    return { code: 0, prose: 0, technical: 0 }
  }

  let code = 0
  let prose = 0
  let technical = 0

  const codePatterns = [
    /\bfunction\s+\w+\s*\(/,
    /\bclass\s+\w+/,
    /\bconst\s+\w+\s*=/,
    /\bimport\s+.*\bfrom\b/,
    /\{[\s\S]*\}/,
    /;[\s\n]/,
    /```[\s\S]*?```/
  ]
  const technicalTerms = [
    'api', 'http', 'parameter', 'configuration', 'endpoint',
    'authentication', 'token', 'request', 'response', 'schema',
    'json', 'yaml', 'kubernetes', 'docker', 'terraform', 'spec'
  ]

  for (const raw of chunks) {
    const content = (raw || '').toLowerCase()
    const isCode = codePatterns.some(re => re.test(content))
    if (isCode) {
      code++
      continue
    }
    const isTechnical = technicalTerms.some(term => content.includes(term))
    if (isTechnical) {
      technical++
    } else {
      prose++
    }
  }

  const total = Math.max(1, code + prose + technical)
  return {
    code: code / total,
    prose: prose / total,
    technical: technical / total
  }
}
