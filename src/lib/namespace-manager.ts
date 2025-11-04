import { ChunkMetadata } from '@/types'

export interface NamespaceConfig {
  id: string
  tenant: string
  environment: 'production' | 'staging' | 'development'
  domain?: string
  created: string
  documentCount: number
  compressionEnabled: boolean
  metadata?: Record<string, unknown>
}

export interface NamespaceMetrics {
  totalNamespaces: number
  byTenant: Record<string, number>
  byEnvironment: Record<string, number>
  totalDocuments: number
  averageDocumentsPerNamespace: number
}

export class NamespaceManager {
  private readonly NAMESPACE_PREFIX = 'namespace-config:'

  async createNamespace(config: Omit<NamespaceConfig, 'created' | 'documentCount'>): Promise<NamespaceConfig> {
    const namespace: NamespaceConfig = {
      ...config,
      created: new Date().toISOString(),
      documentCount: 0
    }

    const key = this.buildNamespaceKey(namespace.id)
    await (window as unknown).spark.kv.set(key, namespace)
    
    return namespace
  }

  async getNamespace(namespaceId: string): Promise<NamespaceConfig | null> {
    const key = this.buildNamespaceKey(namespaceId)
    return await (window as unknown).spark.kv.get(key) || null
  }

  async listNamespaces(): Promise<NamespaceConfig[]> {
    const allKeys = await (window as unknown).spark.kv.keys()
    const namespaceKeys = allKeys.filter((key: string) => key.startsWith(this.NAMESPACE_PREFIX))
    
    const namespaces: NamespaceConfig[] = []
    for (const key of namespaceKeys) {
      const namespace = await (window as unknown).spark.kv.get(key)
      if (namespace) {
        namespaces.push(namespace)
      }
    }
    
    return namespaces.sort((a, b) => a.id.localeCompare(b.id))
  }

  async updateDocumentCount(namespaceId: string, delta: number): Promise<void> {
    const namespace = await this.getNamespace(namespaceId)
    if (namespace) {
      namespace.documentCount = Math.max(0, namespace.documentCount + delta)
      const key = this.buildNamespaceKey(namespaceId)
      await (window as unknown).spark.kv.set(key, namespace)
    }
  }

  async deleteNamespace(namespaceId: string): Promise<void> {
    const key = this.buildNamespaceKey(namespaceId)
    await (window as unknown).spark.kv.delete(key)
  }

  buildMetadataFilter(
    namespaceId: string,
    additionalFilters?: {
      doc_type?: string
      source?: string
      pii_flag?: boolean
      minTimestamp?: string
      maxTimestamp?: string
    }
  ): ChunkMetadata {
    const metadata: ChunkMetadata = {
      namespace_id: namespaceId,
      tenant: namespaceId.split('-')[0] || namespaceId
    }

    if (additionalFilters) {
      if (additionalFilters.doc_type) metadata.doc_type = additionalFilters.doc_type
      if (additionalFilters.source) metadata.source = additionalFilters.source
      if (additionalFilters.pii_flag !== undefined) metadata.pii_flag = additionalFilters.pii_flag
      if (additionalFilters.minTimestamp) metadata.timestamp = additionalFilters.minTimestamp
    }

    return metadata
  }

  async getMetrics(): Promise<NamespaceMetrics> {
    const namespaces = await this.listNamespaces()
    
    const byTenant: Record<string, number> = {}
    const byEnvironment: Record<string, number> = {}
    let totalDocuments = 0

    for (const namespace of namespaces) {
      byTenant[namespace.tenant] = (byTenant[namespace.tenant] || 0) + 1
      byEnvironment[namespace.environment] = (byEnvironment[namespace.environment] || 0) + 1
      totalDocuments += namespace.documentCount
    }

    return {
      totalNamespaces: namespaces.length,
      byTenant,
      byEnvironment,
      totalDocuments,
      averageDocumentsPerNamespace: namespaces.length > 0 ? totalDocuments / namespaces.length : 0
    }
  }

  async getOrCreateDefaultNamespace(): Promise<NamespaceConfig> {
    const defaultId = 'default'
    let namespace = await this.getNamespace(defaultId)
    
    if (!namespace) {
      namespace = await this.createNamespace({
        id: defaultId,
        tenant: 'default',
        environment: 'production',
        compressionEnabled: false
      })
    }
    
    return namespace
  }

  async ensureNamespaceIsolation(namespaceId: string, _documentId: string): Promise<boolean> {
    const namespace = await this.getNamespace(namespaceId)
    return namespace !== null
  }

  private buildNamespaceKey(namespaceId: string): string {
    return `${this.NAMESPACE_PREFIX}${namespaceId}`
  }
}

export const namespaceManager = new NamespaceManager()
