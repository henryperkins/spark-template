import { useEffect, lazy, Suspense } from 'react'
import { useStorage } from '@/hooks/use-kv'
import { ResponsiveNavigation } from '@/components/ResponsiveNavigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Document, AzureConfig } from '@/types'
import { Brain, FileText, ChatCircle, CloudArrowUp, ChartBar, PlugsConnected, TreeStructure } from '@phosphor-icons/react'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cacheManager } from '@/lib/cache-manager'
import { errorTracking } from '@/lib/services/error-tracker'
import { intelligentChunkDocument } from '@/lib/rag'
import { runtime } from '@/lib/config'

const QueryInterface = lazy(() => import('@/components/QueryInterface').then(m => ({ default: m.QueryInterface })))
const DocumentUpload = lazy(() => import('@/components/DocumentUpload').then(m => ({ default: m.DocumentUpload })))
const Integrations = lazy(() => import('@/components/Integrations').then(m => ({ default: m.Integrations })))
const DocumentListV2 = lazy(() => import('@/components/DocumentListV2').then(m => ({ default: m.DocumentListV2 })))
const ScalingDashboard = lazy(() => import('@/components/ScalingDashboard').then(m => ({ default: m.ScalingDashboard })))
const AzureConfiguration = lazy(() => import('@/components/AzureConfiguration').then(m => ({ default: m.AzureConfiguration })))
const ArchitectureDiagram = lazy(() => import('@/components/ArchitectureDiagram').then(m => ({ default: m.ArchitectureDiagram })))

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
)

function App() {
  const [azureConfig] = useStorage<AzureConfig | null>('azure-config', null)

  useEffect(() => {
    // Try environment-based config first (Option A), fall back to localStorage config
    const envConfig = runtime.buildAzureConfigFromEnv()
    const configToUse = envConfig || azureConfig

    if (configToUse) {
      azureServiceManager.initialize(configToUse).catch(error => {
        errorTracking.record(error, {
          type: 'runtime',
          agent: 'App.tsx',
          code: 'azure_init_failed',
          status: 500
        })
      })
    }
  }, [azureConfig])

  const handleDeleteDocument = async (documentId: string) => {
    if (azureServiceManager.isConfigured()) {
      try {
        await azureServiceManager.deleteDocumentFromAzure(documentId)
      } catch (error) {
        console.error('Failed to delete from Azure:', error)
      }
    }

    await cacheManager.invalidateDocument(documentId)
    await cacheManager.invalidateByPrefix('query-expansion')
    await cacheManager.invalidateByPrefix('rag-query')
  }
 
  // Edit handler: fetch meta/chunks from Worker, update locally or via Azure, then persist back to Worker
  const handleEditDocumentContent = async (documentId: string, newContent: string) => {
    // Load existing details
    const detailsResp = await fetch(`/api/documents/${encodeURIComponent(documentId)}`)
    if (!detailsResp.ok) {
      const errText = await detailsResp.text().catch(() => '')
      throw new Error(
        `Failed to load document: ${detailsResp.status} ${detailsResp.statusText}${errText ? ` - ${errText}` : ''}`
      )
    }
    const details = await detailsResp.json()
    const meta = details.meta || {}
    const existingChunks = Array.isArray(details.chunks) ? details.chunks : []
 
    // Build base document from meta/chunks
    const baseDoc: Document = {
      id: documentId,
      name: meta.name,
      size: meta.size,
      uploadedAt: meta.uploadedAt,
      type: meta.type,
      chunks: existingChunks,
      processed: meta.processingStatus === 'completed' || existingChunks.length > 0,
      azureIndexed: meta.azureIndexed,
      processingStatus: meta.processingStatus,
      errorMessage: undefined,
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      sourceMetadata: meta.sourceMetadata,
      originalContent: meta.originalContent
    }
 
    let updated: Document
 
    if (azureServiceManager.isConfigured()) {
      updated = await azureServiceManager.updateDocumentWithAzure(baseDoc, newContent, {
        preserveMetadata: true
      })
    } else {
      const { chunks } = await intelligentChunkDocument(newContent, baseDoc.id, baseDoc.name)
      updated = {
        ...baseDoc,
        chunks,
        processed: true,
        processingStatus: 'completed',
        azureIndexed: false,
        errorMessage: undefined
      }
    }
 
    // Helper to provide Authorization header for Worker mutations
    const getKVAuthHeader = (): Record<string, string> => {
      try {
        const env: any = (import.meta as any)?.env
        const fromEnv = env?.VITE_KV_API_KEY as string | undefined
        let fromLocal: string | undefined
        if (typeof window !== 'undefined') {
          fromLocal = window.localStorage?.getItem('KV_API_KEY') ?? undefined
        }
        const token = fromLocal || fromEnv
        return token ? { Authorization: `Bearer ${token}` } : {}
      } catch {
        return {}
      }
    }
 
    // Persist updated document back to Worker (updates meta + chunks and documents:index)
    const persistResp = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getKVAuthHeader()
      },
      body: JSON.stringify({ document: updated })
    })
    if (!persistResp.ok) {
      console.warn(
        '[App] Persist updated document failed',
        persistResp.status,
        persistResp.statusText
      )
    }
 
    // Invalidate caches
    await cacheManager.invalidateDocument(documentId)
    await cacheManager.invalidateByPrefix('query-expansion')
    await cacheManager.invalidateByPrefix('rag-query')
  }
 
  const NAV_ICON_SIZE = 18

  const navigationTabs = [
    {
      value: 'query',
      label: 'Query',
      icon: <ChatCircle size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <QueryInterface />
        </Suspense>
      )
    },
    {
      value: 'upload',
      label: 'Upload',
      icon: <FileText size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <DocumentUpload onDocumentUploaded={() => {}} />
        </Suspense>
      )
    },
    {
      value: 'integrations',
      label: 'Integrations',
      icon: <PlugsConnected size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <Integrations onDocumentsIngested={() => {}} />
        </Suspense>
      )
    },
    {
      value: 'knowledge',
      label: 'Knowledge',
      icon: <Brain size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <DocumentListV2
            onDeleteDocument={handleDeleteDocument}
            onEditDocument={handleEditDocumentContent}
          />
        </Suspense>
      )
    },
    {
      value: 'scaling',
      label: 'Scaling',
      icon: <ChartBar size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <ScalingDashboard documents={[]} />
        </Suspense>
      )
    },
    {
      value: 'azure',
      label: 'Azure',
      icon: <CloudArrowUp size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <AzureConfiguration />
        </Suspense>
      )
    },
    {
      value: 'architecture',
      label: 'Architecture',
      icon: <TreeStructure size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <ArchitectureDiagram />
        </Suspense>
      )
    }
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-3 py-8 sm:px-6 lg:px-12">
        <div className="mb-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Brain size={28} className="text-primary" />
              <div>
                <h1 className="text-3xl font-bold text-foreground sm:text-4xl">Agentic RAG</h1>
                <p className="text-base text-muted-foreground sm:text-lg">Intelligent Knowledge Assistant</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
          {/* Simplified workflow guidance */}
          <div className="mt-4">
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
              <span>1. Add content</span>
              <span className="text-border">•</span>
              <span>2. (Optional) Connect Azure</span>
              <span className="text-border">•</span>
              <span className="font-medium text-foreground">3. Ask questions</span>
              <span className="text-border">•</span>
              <span>4. Monitor & tune</span>
            </div>
          </div>
        </div>

        <ResponsiveNavigation
          tabs={navigationTabs}
          defaultValue="query"
          className="space-y-6 sm:space-y-8"
        />
      </div>
    </div>
  )
}

export default App
