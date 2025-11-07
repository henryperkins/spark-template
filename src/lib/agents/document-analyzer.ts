import { z } from 'zod'
import { llmService, LLMError } from '../services/llm-service'
import type { AgentResult, ChunkingDecision, ChunkingStrategy } from './types'
import { jsonRepairAgent } from './json-repair-agent'

export const chunkingDecisionSchema: z.ZodType<ChunkingDecision> = z.object({
  strategy: z.enum(['paragraph', 'sentence', 'semantic', 'fixed']),
  chunkSize: z.number().int().min(200).max(4000),
  overlap: z.number().int().min(0).max(800),
  reasoning: z.string().min(5)
})

export class DocumentAnalyzerAgent {
  /**
   * Normalize fileName for cache key stability.
   * Removes " - Copy" variants and lowercases to prevent duplicate analyses.
   */
  private normalizeFileName(fileName: string): string {
    return fileName.toLowerCase().replace(/\s+-\s+copy(\.\w+)?$/i, '$1')
  }

  async analyzeDocumentResult(
    fileName: string,
    contentSample: string
  ): Promise<AgentResult<ChunkingDecision>> {
    const systemPrompt = `You are a document analysis expert. Analyze the provided document name and content sample and recommend an optimal chunking strategy for downstream retrieval. Consider clarity, cohesion, and answerability.

Strategy types:
- PARAGRAPH: well-structured documents with clear paragraphs
- SENTENCE: dense technical documents where precision matters
- SEMANTIC: varying section lengths (books, manuals)
- FIXED: uniform content (logs, data dumps)

Chunk size guidelines:
- Small (500-800): technical, code, precise Q&A
- Medium (800-1200): articles, general documents
- Large (1200-2000): long-form content

Overlap: prefer 10–20% for context preservation.

Return ONLY valid JSON. No markdown fences. No comments. No explanations. Output must be a single JSON object that matches this schema: {"type":"object","properties":{"strategy":{"type":"string","enum":["paragraph","sentence","semantic","fixed"]},"chunkSize":{"type":"integer","minimum":200,"maximum":4000},"overlap":{"type":"integer","minimum":0,"maximum":800},"reasoning":{"type":"string","minLength":5}},"required":["strategy","chunkSize","overlap","reasoning"],"additionalProperties":false}

Document name: ${fileName}
Content sample (first 500 chars):\n${contentSample}`

    try {
      const value = await llmService.generateJson(systemPrompt, chunkingDecisionSchema, { maxTokens: 300 })
      return { ok: true, value }
    } catch (err) {
      if (err instanceof LLMError && err.code === 'EPARSE') {
        const raw = (err as LLMError).rawText || (err.message?.replace(/^Could not parse JSON from LLM response:\s*/, '') ?? '')
        const repaired = jsonRepairAgent.tryRepairJson<ChunkingDecision>({ rawText: raw, schema: chunkingDecisionSchema, contextLabel: 'chunking-decision' })
        if (repaired.ok) {
          console.info('[DocumentAnalyzerAgent] LLM_JSON_REPAIR_SUCCESS', { attempts: repaired.attempts })
          return { ok: true, value: repaired.value, meta: { repaired: true, attempts: repaired.attempts } }
        }
        const fb = this.fallbackAnalysis(fileName, contentSample)
        console.warn('[DocumentAnalyzerAgent] LLM_JSON_PARSE_FAIL → LLM_FALLBACK_USED', { reason: 'json_parse_failed' })
        return { ok: true, value: fb, meta: { fallback: true, reason: 'json_parse_failed' } }
      }
      // Infra/network or other errors → fallback but keep UX
      const fb = this.fallbackAnalysis(fileName, contentSample)
      console.warn('[DocumentAnalyzerAgent] LLM_UNAVAILABLE → LLM_FALLBACK_USED', { reason: 'llm_unavailable' })
      return { ok: true, value: fb, meta: { fallback: true, reason: 'llm_unavailable' } }
    }
  }

  // Back-compat method used by ingestion utilities
  async analyzeDocument(
    fileName: string,
    contentSample: string
  ): Promise<ChunkingDecision> {
    const res = await this.analyzeDocumentResult(fileName, contentSample)
    if (res.ok) return res.value
    // Conservative default on hard failure
    return { strategy: 'semantic', chunkSize: 1000, overlap: 100, reasoning: 'Conservative default (agent failure)' }
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

  async computeContentHash(content: string): Promise<string> {
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

  // Caching is orchestrated at Layer 4 state machine
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

// Re-export public types for backward compatibility
export type { ChunkingStrategy, ChunkingDecision } from './types'
