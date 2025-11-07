import { Document, DocumentChunk, Source } from '@/types'
import { cacheManager } from './cache-manager'
import { azureServiceManager } from './azure-service-manager'
import { DocumentAnalyzerAgent, ChunkingStrategy } from './agents/document-analyzer'

 // window.spark types are declared in global ambient declarations


export interface FindRelevantChunksOptions {
  onAzureFallback?: () => void
}

export async function intelligentChunkDocument(
  content: string,
  documentId: string,
  fileName: string
): Promise<{ chunks: DocumentChunk[]; strategy: ChunkingStrategy }> {
  const analyzer = new DocumentAnalyzerAgent()
  const contentSample = content.substring(0, 500)

  const decision = await analyzer.analyzeDocument(fileName, contentSample)

  let chunks: DocumentChunk[]

  switch (decision.strategy) {
    case 'paragraph':
      chunks = chunkByParagraph(content, documentId, decision.chunkSize, decision.overlap)
      break
    case 'sentence':
      chunks = chunkBySentence(content, documentId, decision.chunkSize, decision.overlap)
      break
    case 'semantic':
      chunks = chunkBySemantic(content, documentId, decision.chunkSize, decision.overlap)
      break
    case 'fixed':
      chunks = chunkByFixed(content, documentId, decision.chunkSize, decision.overlap)
      break
    default:
      chunks = chunkDocument(content, documentId, decision.chunkSize)
  }

  return { chunks, strategy: decision.strategy }
}

function chunkByParagraph(
  content: string,
  documentId: string,
  maxChunkSize: number,
  overlap: number
): DocumentChunk[] {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const chunks: DocumentChunk[] = []
  let chunkIndex = 0
  let currentChunk = ''
  let previousOverlap = ''

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    const withOverlap = previousOverlap + (currentChunk ? '\n\n' : '') + trimmed

    if (withOverlap.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `${documentId}-chunk-${chunkIndex}`,
        content: currentChunk.trim(),
        documentId,
        chunkIndex
      })

      previousOverlap = currentChunk.substring(Math.max(0, currentChunk.length - overlap))
      currentChunk = trimmed
      chunkIndex++
    } else {
      currentChunk = withOverlap
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      id: `${documentId}-chunk-${chunkIndex}`,
      content: currentChunk.trim(),
      documentId,
      chunkIndex
    })
  }

  return chunks.length > 0 ? chunks : [{
    id: `${documentId}-chunk-0`,
    content: content.trim(),
    documentId,
    chunkIndex: 0
  }]
}

function chunkBySentence(
  content: string,
  documentId: string,
  maxChunkSize: number,
  _overlap: number
): DocumentChunk[] {
  const sentences = content.split(/[.!?]+\s+/).filter(s => s.trim().length > 0)
  const chunks: DocumentChunk[] = []
  let chunkIndex = 0
  let currentChunk = ''
  let sentenceBuffer: string[] = []

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    sentenceBuffer.push(trimmed)
    const proposed = sentenceBuffer.join('. ') + '.'

    if (proposed.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `${documentId}-chunk-${chunkIndex}`,
        content: currentChunk,
        documentId,
        chunkIndex
      })

      const overlapSentences = Math.ceil(sentenceBuffer.length * 0.2)
      sentenceBuffer = sentenceBuffer.slice(-overlapSentences)
      currentChunk = sentenceBuffer.join('. ') + '.'
      chunkIndex++
    } else {
      currentChunk = proposed
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      id: `${documentId}-chunk-${chunkIndex}`,
      content: currentChunk,
      documentId,
      chunkIndex
    })
  }

  return chunks.length > 0 ? chunks : [{
    id: `${documentId}-chunk-0`,
    content: content.trim(),
    documentId,
    chunkIndex: 0
  }]
}

function chunkBySemantic(
  content: string,
  documentId: string,
  maxChunkSize: number,
  overlap: number
): DocumentChunk[] {
  return chunkByParagraph(content, documentId, maxChunkSize, overlap)
}

function chunkByFixed(
  content: string,
  documentId: string,
  chunkSize: number,
  overlap: number
): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let chunkIndex = 0
  let position = 0

  while (position < content.length) {
    const end = Math.min(position + chunkSize, content.length)
    const chunk = content.substring(position, end)

    chunks.push({
      id: `${documentId}-chunk-${chunkIndex}`,
      content: chunk.trim(),
      documentId,
      chunkIndex
    })

    position += chunkSize - overlap
    chunkIndex++
  }

  return chunks.length > 0 ? chunks : [{
    id: `${documentId}-chunk-0`,
    content: content.trim(),
    documentId,
    chunkIndex: 0
  }]
}

export function chunkDocument(content: string, documentId: string, maxChunkSize: number = 1000): DocumentChunk[] {
  // Split by sentences and paragraphs for better semantic chunks
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const chunks: DocumentChunk[] = []
  let chunkIndex = 0

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0)
    let currentChunk = ''

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim()
      const proposedChunk = currentChunk + (currentChunk ? '. ' : '') + trimmedSentence

      if (proposedChunk.length > maxChunkSize && currentChunk.length > 0) {
        // Save current chunk and start new one
        chunks.push({
          id: `${documentId}-chunk-${chunkIndex}`,
          content: currentChunk.trim(),
          documentId,
          chunkIndex
        })
        currentChunk = trimmedSentence
        chunkIndex++
      } else {
        currentChunk = proposedChunk
      }
    }

    // Add remaining content as a chunk
    if (currentChunk.trim()) {
      chunks.push({
        id: `${documentId}-chunk-${chunkIndex}`,
        content: currentChunk.trim(),
        documentId,
        chunkIndex
      })
      chunkIndex++
    }
  }

  return chunks.length > 0 ? chunks : [{
    id: `${documentId}-chunk-0`,
    content: content.trim(),
    documentId,
    chunkIndex: 0
  }]
}

export function calculateSimilarity(query: string, chunk: DocumentChunk): number {
  const queryWords = query.toLowerCase().split(/\s+/)
  const chunkWords = chunk.content.toLowerCase().split(/\s+/)

  const querySet = new Set(queryWords)
  const chunkSet = new Set(chunkWords)

  const intersection = new Set([...querySet].filter(word => chunkSet.has(word)))
  const union = new Set([...querySet, ...chunkSet])

  return intersection.size / union.size
}

/**
 * Compute cosine similarity between two numeric vectors
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const va = a[i]
    const vb = b[i]
    dot += va * vb
    na += va * va
    nb += vb * vb
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Reciprocal Rank Fusion (RRF) of two ranked lists
 */
export function rrfFuse(a: Source[], b: Source[], k: number = 60): Source[] {
  const scoreMap = new Map<string, { source: Source; score: number }>()
  const addList = (list: Source[]) => {
    list.forEach((s, idx) => {
      const key = s.chunkId
      const existing = scoreMap.get(key)
      const rr = 1 / (k + (idx + 1))
      if (existing) {
        existing.score += rr
        // keep highest relevanceScore seen
        if (s.relevanceScore > existing.source.relevanceScore) {
          existing.source = s
        }
      } else {
        scoreMap.set(key, { source: s, score: rr })
      }
    })
  }
  addList(a)
  addList(b)
  return [...scoreMap.values()]
    .sort((x, y) => y.score - x.score)
    .map(v => v.source)
}

export async function findRelevantChunks(
  query: string,
  documents: Document[],
  maxResults: number = 5,
  strategy: 'vector' | 'keyword' | 'hybrid' = 'hybrid',
  options?: FindRelevantChunksOptions
): Promise<Source[]> {
  const normalizedQuery = query.trim().toLowerCase()
  const documentFingerprint = documents
    .filter(doc => doc.chunks && doc.chunks.length > 0)
    .map(doc => `${doc.id}:${doc.chunks.length}:${doc.azureIndexed ? '1' : '0'}`)
    .sort()
    .join('|') || 'no-docs'

  const baseKey = `rag-query:${strategy}:${maxResults}:${hashString(normalizedQuery)}:${hashString(documentFingerprint)}:`
  const azureConfigured = azureServiceManager.isConfigured()

  // Local-only path
  if (!azureConfigured) {
    // Surface degraded mode even when Azure is disabled from the start
    options?.onAzureFallback?.()

    const cachedLocal = await cacheManager.get<Source[]>(`${baseKey}local`)
    if (cachedLocal) return cachedLocal

    const localSources = await findRelevantChunksLocal(query, documents, maxResults, strategy)
    await cacheManager.set(`${baseKey}local`, localSources)
    return localSources
  }

  // Azure-configured path: try Azure cache first
  const cachedAzure = await cacheManager.get<Source[]>(`${baseKey}azure`)
  if (cachedAzure) return cachedAzure

  try {
    const azureSources = await azureServiceManager.searchWithAzure(query, strategy)
    if (azureSources.length > 0) {
      const sliced = azureSources.slice(0, maxResults)
      await cacheManager.set(`${baseKey}azure`, sliced)
      return sliced
    }
    // Azure responded successfully but returned no matches; fall through to local without marking Azure offline
  } catch (error) {
    console.warn('Azure search failed, falling back to local search:', error)
    options?.onAzureFallback?.()
  }

  // Before computing local, check local-on-fallback cache
  const cachedLocalOnFallback = await cacheManager.get<Source[]>(`${baseKey}azure-fallback-local`)
  if (cachedLocalOnFallback) return cachedLocalOnFallback

  const local = await findRelevantChunksLocal(query, documents, maxResults, strategy)
  await cacheManager.set(`${baseKey}azure-fallback-local`, local)
  return local
}

export async function findRelevantChunksLocal(
  query: string,
  documents: Document[],
  maxResults: number = 5,
  strategy: 'vector' | 'keyword' | 'hybrid' = 'hybrid'
): Promise<Source[]> {
  const allChunks: Array<{ chunk: DocumentChunk; document: Document }> = []
  documents.forEach(doc => {
    if (doc.chunks && doc.chunks.length > 0) {
      doc.chunks.forEach(chunk => allChunks.push({ chunk, document: doc }))
    }
  })

  const keywordScores = (): Source[] => {
    const scored = allChunks
      .map(({ chunk, document }) => ({
        documentId: document.id,
        documentName: document.name,
        chunkId: chunk.id,
        content: chunk.content,
        relevanceScore: calculateSimilarity(query, chunk)
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)

    let filtered = scored.filter(s => s.relevanceScore > 0.1)
    if (filtered.length === 0) filtered = scored.filter(s => s.relevanceScore > 0.0)
    if (filtered.length === 0 && scored.length > 0) filtered = scored.slice(0, maxResults)
    return filtered.slice(0, maxResults)
  }

  const vectorScores = async (): Promise<Source[]> => {
    // Get query embedding only if OpenAI is available
    if (!azureServiceManager.hasOpenAI()) return []

    const queryEmbedding = await azureServiceManager.tryGenerateQueryEmbedding(query)
    if (!queryEmbedding || queryEmbedding.length === 0) return []

    // Use any available embeddings on chunks
    const vectorized = allChunks
      .map(({ chunk, document }) => {
        const vec = chunk.azureEmbedding || chunk.embedding
        if (!vec || vec.length === 0) return null
        return {
          documentId: document.id,
          documentName: document.name,
          chunkId: chunk.id,
          content: chunk.content,
          relevanceScore: computeCosineSimilarity(queryEmbedding, vec)
        } as Source
      })
      .filter(Boolean) as Source[]

    return vectorized.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, maxResults)
  }

  const runStrategy = async (s: 'vector' | 'keyword' | 'hybrid'): Promise<Source[]> => {
    if (s === 'keyword') {
      return keywordScores()
    }
    if (s === 'vector') {
      return await vectorScores()
    }
    // hybrid
    const v = await vectorScores()
    const k = keywordScores()
    if (v.length === 0) {
      // If no vector candidates, fall back to keyword results for hybrid
      return k.slice(0, maxResults)
    }
    return rrfFuse(v, k, 60).slice(0, maxResults)
  }

  let result = await runStrategy(strategy)

  if (result.length === 0) {
    const fallbacks: ('hybrid' | 'keyword' | 'vector')[] = ['hybrid', 'keyword', 'vector']
    for (const alt of fallbacks) {
      if (alt === strategy) continue
      result = await runStrategy(alt)
      if (result.length > 0) break
    }
  }

  return result.slice(0, maxResults)
}

export async function generateResponse(query: string, sources: Source[]): Promise<string> {
  if (sources.length === 0) {
    return "I don't have enough relevant information in the knowledge base to answer your question. Please try uploading more documents or rephrasing your query."
  }

  // Try Azure OpenAI first if configured
  if (azureServiceManager.isConfigured()) {
    try {
      return await azureServiceManager.generateResponseWithAzure(query, sources)
    } catch (error) {
      console.warn('Azure completion failed, falling back to Spark LLM:', error)
    }
  }

  // Fallback to Spark LLM
  const context = sources
    .map((source, index) => `[${index + 1}] ${source.content}`)
    .join('\n\n')

  const prompt = window.spark!.llmPrompt`You are a helpful research assistant. Answer the user's question based on the provided context from documents. Be accurate and cite your sources using the numbers in brackets.

Context from documents:
${context}

User question: ${query}

Please provide a comprehensive answer based on the context above. If the context doesn't fully answer the question, acknowledge what information is missing. Always cite your sources using the numbers in brackets (e.g., [1], [2]).`

  try {
    const response = await window.spark!.llm(prompt)
    return response
  } catch {
    return "I apologize, but I'm having trouble processing your request right now. Please try again in a moment."
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }

  return hash.toString(16)
}
