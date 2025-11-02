import { Document } from '@/types'

export interface EmbeddingMetadata {
  version: string
  lastRefreshed: string
  checksum: string
  modelVersion: string
  chunkCount: number
  documentId: string
  documentName: string
  volatility: 'high' | 'medium' | 'low'
}

export interface EmbeddingRefreshConfig {
  strategy: 'incremental' | 'full' | 'hybrid'
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'
  enableVersioning: boolean
  currentVersion: string
}

export interface RefreshResult {
  refreshedCount: number
  skippedCount: number
  totalProcessed: number
  duration: number
  changes: Array<{
    documentId: string
    documentName: string
    action: 'refreshed' | 'skipped' | 'added'
    reason: string
  }>
}

export class EmbeddingManager {
  private readonly EMBEDDING_VERSION = 'v2025.01'
  
  async calculateChecksum(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async getMetadata(documentId: string): Promise<EmbeddingMetadata | null> {
    const key = `embedding-metadata:${documentId}`
    return await (window as any).spark.kv.get(key) as EmbeddingMetadata | null || null
  }

  async setMetadata(metadata: EmbeddingMetadata): Promise<void> {
    const key = `embedding-metadata:${metadata.documentId}`
    await (window as any).spark.kv.set(key, metadata)
  }

  async needsRefresh(document: Document): Promise<{ needed: boolean; reason: string }> {
    const metadata = await this.getMetadata(document.id)
    
    if (!metadata) {
      return { needed: true, reason: 'No metadata found - initial indexing required' }
    }

    if (metadata.version !== this.EMBEDDING_VERSION) {
      return { needed: true, reason: `Version mismatch: ${metadata.version} -> ${this.EMBEDDING_VERSION}` }
    }

    const currentChecksum = await this.calculateDocumentChecksum(document)
    if (metadata.checksum !== currentChecksum) {
      return { needed: true, reason: 'Content changed - checksum mismatch' }
    }

    if (metadata.chunkCount !== document.chunks.length) {
      return { needed: true, reason: 'Chunk count changed' }
    }

    const lastRefreshedDate = new Date(metadata.lastRefreshed)
    const daysSinceRefresh = (Date.now() - lastRefreshedDate.getTime()) / (1000 * 60 * 60 * 24)

    const refreshThreshold = this.getRefreshThreshold(metadata.volatility)
    if (daysSinceRefresh > refreshThreshold) {
      return { needed: true, reason: `Exceeded refresh threshold: ${daysSinceRefresh.toFixed(1)} days` }
    }

    return { needed: false, reason: 'Up to date' }
  }

  private async calculateDocumentChecksum(document: Document): Promise<string> {
    const content = document.chunks
      .map(chunk => chunk.content)
      .join('|')
    return await this.calculateChecksum(content)
  }

  private getRefreshThreshold(volatility: 'high' | 'medium' | 'low'): number {
    switch (volatility) {
      case 'high': return 1
      case 'medium': return 7
      case 'low': return 30
    }
  }

  async performIncrementalRefresh(
    documents: Document[],
    onProgress?: (progress: { current: number; total: number; documentName: string }) => void
  ): Promise<RefreshResult> {
    const startTime = Date.now()
    const changes: RefreshResult['changes'] = []
    let refreshedCount = 0
    let skippedCount = 0

    for (let i = 0; i < documents.length; i++) {
      const document = documents[i]
      
      if (onProgress) {
        onProgress({ current: i + 1, total: documents.length, documentName: document.name })
      }

      const { needed, reason } = await this.needsRefresh(document)

      if (needed) {
        changes.push({
          documentId: document.id,
          documentName: document.name,
          action: 'refreshed',
          reason
        })
        refreshedCount++

        await this.updateMetadata(document)
      } else {
        changes.push({
          documentId: document.id,
          documentName: document.name,
          action: 'skipped',
          reason
        })
        skippedCount++
      }
    }

    const duration = Date.now() - startTime

    return {
      refreshedCount,
      skippedCount,
      totalProcessed: documents.length,
      duration,
      changes
    }
  }

  async performFullRefresh(
    documents: Document[],
    onProgress?: (progress: { current: number; total: number; documentName: string }) => void
  ): Promise<RefreshResult> {
    const startTime = Date.now()
    const changes: RefreshResult['changes'] = []

    for (let i = 0; i < documents.length; i++) {
      const document = documents[i]
      
      if (onProgress) {
        onProgress({ current: i + 1, total: documents.length, documentName: document.name })
      }

      changes.push({
        documentId: document.id,
        documentName: document.name,
        action: 'refreshed',
        reason: 'Full refresh scheduled'
      })

      await this.updateMetadata(document)
    }

    const duration = Date.now() - startTime

    return {
      refreshedCount: documents.length,
      skippedCount: 0,
      totalProcessed: documents.length,
      duration,
      changes
    }
  }

  private async updateMetadata(document: Document): Promise<void> {
    const checksum = await this.calculateDocumentChecksum(document)
    const metadata: EmbeddingMetadata = {
      version: this.EMBEDDING_VERSION,
      lastRefreshed: new Date().toISOString(),
      checksum,
      modelVersion: 'text-embedding-ada-002',
      chunkCount: document.chunks.length,
      documentId: document.id,
      documentName: document.name,
      volatility: this.inferVolatility(document)
    }

    await this.setMetadata(metadata)
  }

  private inferVolatility(document: Document): 'high' | 'medium' | 'low' {
    const name = document.name.toLowerCase()
    
    if (name.includes('news') || name.includes('update') || name.includes('changelog')) {
      return 'high'
    }
    
    if (name.includes('report') || name.includes('analysis') || name.includes('summary')) {
      return 'medium'
    }
    
    return 'low'
  }

  async getVersionedNamespace(): Promise<string> {
    return `embeddings:${this.EMBEDDING_VERSION}`
  }

  async listAllVersions(): Promise<string[]> {
    const allKeys = await (window as any).spark.kv.keys()
    const metadataKeys = allKeys.filter(key => key.startsWith('embedding-metadata:'))
    const versions = new Set<string>()

    for (const key of metadataKeys) {
      const metadata = await (window as any).spark.kv.get(key) as EmbeddingMetadata | null
      if (metadata?.version) {
        versions.add(metadata.version)
      }
    }

    return Array.from(versions).sort()
  }

  async getRefreshMetrics(): Promise<{
    totalDocuments: number
    byVersion: Record<string, number>
    byVolatility: Record<string, number>
    needingRefresh: number
    averageDaysSinceRefresh: number
  }> {
    const allKeys = await (window as any).spark.kv.keys()
    const metadataKeys = allKeys.filter(key => key.startsWith('embedding-metadata:'))
    
    const byVersion: Record<string, number> = {}
    const byVolatility: Record<string, number> = {}
    let totalDays = 0
    let needingRefresh = 0

    for (const key of metadataKeys) {
      const metadata = await (window as any).spark.kv.get(key) as EmbeddingMetadata | null
      if (!metadata) continue

      byVersion[metadata.version] = (byVersion[metadata.version] || 0) + 1
      byVolatility[metadata.volatility] = (byVolatility[metadata.volatility] || 0) + 1

      const daysSince = (Date.now() - new Date(metadata.lastRefreshed).getTime()) / (1000 * 60 * 60 * 24)
      totalDays += daysSince

      if (daysSince > this.getRefreshThreshold(metadata.volatility)) {
        needingRefresh++
      }
    }

    return {
      totalDocuments: metadataKeys.length,
      byVersion,
      byVolatility,
      needingRefresh,
      averageDaysSinceRefresh: metadataKeys.length > 0 ? totalDays / metadataKeys.length : 0
    }
  }
}

export const embeddingManager = new EmbeddingManager()
