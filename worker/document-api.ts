import { Env } from './index'
import { DocumentIndex, DocumentMeta, DocumentChunk, Document } from '../src/types'

// Helper to access KV namespace (uses RAG_KV binding)
const getKV = (env: Env) => env.RAG_KV

// Helper function to extract metadata from full document
function extractDocumentIndex(document: Document): DocumentIndex {
  return {
    id: document.id,
    name: document.name,
    size: document.size,
    uploadedAt: document.uploadedAt,
    type: document.type,
    source: document.source,
    sourceUrl: document.sourceUrl,
    processingStatus: document.processingStatus || 'completed',
    azureIndexed: document.azureIndexed,
    errorMessage: document.errorMessage,
    chunkCount: document.chunks?.length || 0,
    hasVectors: document.chunks?.some(chunk => chunk.azureEmbedding) || false
  }
}

// Helper function to extract metadata without chunks
function extractDocumentMeta(document: Document): DocumentMeta {
  const { chunks, ...meta } = document
  return {
    ...meta,
    sourceMetadata: document.sourceMetadata,
    originalContent: (document as any).originalContent
  }
}

export async function handleListDocuments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  try {
    const kv = getKV(env)

    // Check for legacy data migration
    const legacyData = await kv.get('rag-documents', { type: 'json' }) as Document[] | null

    if (legacyData) {
      // Migrate legacy data to new format
      const documentIndex: DocumentIndex[] = legacyData.map(doc => extractDocumentIndex(doc))
      await kv.put('documents:index', JSON.stringify(documentIndex))

      // Store individual document data
      for (const doc of legacyData) {
        await kv.put(`document:${doc.id}:meta`, JSON.stringify(extractDocumentMeta(doc)))
        await kv.put(`document:${doc.id}:chunks`, JSON.stringify(doc.chunks))
      }

      // Remove legacy key after successful migration
      await kv.delete('rag-documents')
    }

    // Get query parameters
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50')
    const q = url.searchParams.get('q') || ''
    const source = url.searchParams.get('source') || ''
    const status = url.searchParams.get('status') || ''
    const azureIndexed = url.searchParams.get('azureIndexed')

    // Get document index
    const indexData = await kv.get('documents:index', { type: 'json' }) as DocumentIndex[] | null
    let documents = indexData || []

    // Apply filters
    if (q) {
      const query = q.toLowerCase()
      documents = documents.filter(doc => 
        doc.name.toLowerCase().includes(query) ||
        (doc.source && doc.source.toLowerCase().includes(query))
      )
    }

    if (source) {
      documents = documents.filter(doc => doc.source === source)
    }

    if (status) {
      documents = documents.filter(doc => doc.processingStatus === status)
    }

    if (azureIndexed !== null) {
      const isIndexed = azureIndexed === 'true'
      documents = documents.filter(doc => doc.azureIndexed === isIndexed)
    }

    // Sort by uploadedAt desc
    documents.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    // Apply pagination
    const total = documents.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginatedDocuments = documents.slice(startIndex, endIndex)

    return new Response(JSON.stringify({
      documents: paginatedDocuments,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    }), { headers: corsHeaders })

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
}

export async function handleGetDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  try {
    const [metaData, chunksData] = await Promise.all([
      getKV(env).get(`document:${documentId}:meta`, { type: 'json' }),
      getKV(env).get(`document:${documentId}:chunks`, { type: 'json' })
    ])

    if (!metaData) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404,
        headers: corsHeaders
      })
    }

    return new Response(JSON.stringify({
      meta: metaData,
      chunks: chunksData || []
    }), { headers: corsHeaders })

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
}

export async function handleUpdateDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  try {
    // Accept multiple payload shapes to support both create and update:
    // 1) { document: Document }                    → persist full doc (create or upsert)
    // 2) { meta: DocumentMeta, chunks: DocumentChunk[] } → persist split payload
    // 3) { content: string, preserveMetadata?: boolean } → legacy update note (no-op persist)
    const body = await request.json().catch(() => ({} as any))
    const { document, meta, chunks, content } = body as {
      document?: Document
      meta?: DocumentMeta
      chunks?: DocumentChunk[]
      content?: string
      preserveMetadata?: boolean
    }

    // Upsert path: full Document provided
    if (document && typeof document === 'object') {
      if (document.id && document.id !== documentId) {
        return new Response(JSON.stringify({ error: 'Document ID mismatch' }), {
          status: 400,
          headers: corsHeaders
        })
      }

      const metaToSave = extractDocumentMeta(document)
      const chunksToSave: DocumentChunk[] = Array.isArray(document.chunks) ? document.chunks : []

      // Persist meta and chunks
      await getKV(env).put(`document:${documentId}:meta`, JSON.stringify(metaToSave))
      await getKV(env).put(`document:${documentId}:chunks`, JSON.stringify(chunksToSave))

      // Update documents:index
      const indexData = await getKV(env).get('documents:index', { type: 'json' }) as DocumentIndex[] | null
      const index = indexData || []
      const entry = extractDocumentIndex(document)
      const existingIdx = index.findIndex(d => d.id === documentId)
      if (existingIdx >= 0) {
        index[existingIdx] = entry
      } else {
        index.push(entry)
      }
      await getKV(env).put('documents:index', JSON.stringify(index))

      return new Response(JSON.stringify({ success: true, document: metaToSave }), { headers: corsHeaders })
    }

    // Upsert path: meta + chunks provided
    if (meta && typeof meta === 'object' && Array.isArray(chunks)) {
      // Build a temporary full document for index derivation
      const tempDoc: Document = {
        id: documentId,
        name: meta.name,
        size: meta.size,
        uploadedAt: meta.uploadedAt,
        type: meta.type,
        source: meta.source,
        sourceUrl: meta.sourceUrl,
        processed: meta.processingStatus === 'completed',
        azureIndexed: meta.azureIndexed,
        processingStatus: meta.processingStatus,
        errorMessage: meta.errorMessage,
        sourceMetadata: meta.sourceMetadata,
        originalContent: meta.originalContent,
        chunks
      }

      const metaToSave = extractDocumentMeta(tempDoc)

      await getKV(env).put(`document:${documentId}:meta`, JSON.stringify(metaToSave))
      await getKV(env).put(`document:${documentId}:chunks`, JSON.stringify(chunks))

      // Update documents:index
      const indexData = await getKV(env).get('documents:index', { type: 'json' }) as DocumentIndex[] | null
      const index = indexData || []
      const entry = extractDocumentIndex(tempDoc)
      const existingIdx = index.findIndex(d => d.id === documentId)
      if (existingIdx >= 0) {
        index[existingIdx] = entry
      } else {
        index.push(entry)
      }
      await getKV(env).put('documents:index', JSON.stringify(index))

      return new Response(JSON.stringify({ success: true, document: metaToSave }), { headers: corsHeaders })
    }

    // Legacy content-only path: return existing meta and no-op
    if (typeof content === 'string') {
      const metaData = await getKV(env).get(`document:${documentId}:meta`, { type: 'json' })
      if (!metaData) {
        return new Response(JSON.stringify({ error: 'Document not found' }), {
          status: 404,
          headers: corsHeaders
        })
      }
      return new Response(JSON.stringify({
        success: true,
        document: metaData,
        note: 'Content-only update requires client-side chunking/embedding. No changes persisted.'
      }), { headers: corsHeaders })
    }

    return new Response(JSON.stringify({ error: 'Invalid payload' }), {
      status: 400,
      headers: corsHeaders
    })
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Internal server error'
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
}

export async function handleDeleteDocument(request: Request, env: Env, documentId: string): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  try {
    // Delete document data
    await Promise.all([
      getKV(env).delete(`document:${documentId}:meta`),
      getKV(env).delete(`document:${documentId}:chunks`),
      getKV(env).delete(`document:${documentId}:vectors`)
    ])

    // Update index
    const indexData = await getKV(env).get('documents:index', { type: 'json' }) as DocumentIndex[] | null
    if (indexData) {
      const updatedIndex = indexData.filter(doc => doc.id !== documentId)
      await getKV(env).put('documents:index', JSON.stringify(updatedIndex))
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders })

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
}

export async function handleGetChunks(request: Request, env: Env, documentId: string): Promise<Response> {
  const url = new URL(request.url)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  }

  try {
    const page = parseInt(url.searchParams.get('page') || '1')
    const pageSize = parseInt(url.searchParams.get('pageSize') || '100')

    const chunksData = await getKV(env).get(`document:${documentId}:chunks`, { type: 'json' }) as DocumentChunk[] | null

    if (!chunksData) {
      return new Response(JSON.stringify({ 
        documentId,
        chunks: [],
        pagination: {
          page: 1,
          pageSize,
          total: 0,
          totalPages: 0
        }
      }), { headers: corsHeaders })
    }

    const total = chunksData.length
    const totalPages = Math.ceil(total / pageSize)
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginatedChunks = chunksData.slice(startIndex, endIndex)

    return new Response(JSON.stringify({
      documentId,
      chunks: paginatedChunks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    }), { headers: corsHeaders })

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: corsHeaders
    })
  }
}