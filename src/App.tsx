import { useEffect, lazy, Suspense } from 'react'
import { useStorage } from '@/hooks/use-kv'
import { ResponsiveNavigation } from '@/components/ResponsiveNavigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Document, AzureConfig } from '@/types'
import { Brain, FileText, ChatCircle, CloudArrowUp, ChartBar, PlugsConnected, TreeStructure } from '@phosphor-icons/react'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cacheManager } from '@/lib/cache-manager'

const QueryInterface = lazy(() => import('@/components/QueryInterface').then(m => ({ default: m.QueryInterface })))
const DocumentUpload = lazy(() => import('@/components/DocumentUpload').then(m => ({ default: m.DocumentUpload })))
const Integrations = lazy(() => import('@/components/Integrations').then(m => ({ default: m.Integrations })))
const DocumentList = lazy(() => import('@/components/DocumentList').then(m => ({ default: m.DocumentList })))
const ScalingDashboard = lazy(() => import('@/components/ScalingDashboard').then(m => ({ default: m.ScalingDashboard })))
const AzureConfiguration = lazy(() => import('@/components/AzureConfiguration').then(m => ({ default: m.AzureConfiguration })))
const ArchitectureDiagram = lazy(() => import('@/components/ArchitectureDiagram').then(m => ({ default: m.ArchitectureDiagram })))

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
)

function App() {
  const [documents, setDocuments] = useStorage<Document[]>('rag-documents', [])
  const [azureConfig] = useStorage<AzureConfig | null>('azure-config', null)

  useEffect(() => {
    // Initialize Azure services if config exists
    if (azureConfig) {
      azureServiceManager.initialize(azureConfig).catch(console.error)
    }
  }, [azureConfig])

  const handleDocumentUploaded = (newDocument: Document) => {
    setDocuments((prev = []) => [...prev, newDocument])
  }

  const handleDocumentsIngested = (newDocuments: Document[]) => {
    setDocuments((prev = []) => [...prev, ...newDocuments])
  }

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

    setDocuments((prev = []) => prev.filter(doc => doc.id !== documentId))
  }

  const handleEditDocumentContent = async (
    documentId: string,
    newContent: string
  ): Promise<void> => {
    const target = (documents || []).find(d => d.id === documentId)
    if (!target) return

    try {
      let updated: Document

      if (azureServiceManager.isConfigured()) {
        updated = await azureServiceManager.updateDocumentWithAzure(target, newContent, {
          preserveMetadata: true
        })
      } else {
        const { intelligentChunkDocument } = await import('@/lib/rag')
        const { chunks } = await intelligentChunkDocument(newContent, target.id, target.name)
        updated = {
          ...target,
          chunks,
          processed: true,
          azureIndexed: false,
          processingStatus: 'completed',
          errorMessage: undefined
        }
      }

      setDocuments((prev = []) =>
        (prev || []).map(doc => (doc.id === documentId ? updated : doc))
      )

      await cacheManager.invalidateDocument(documentId)
      await cacheManager.invalidateByPrefix('query-expansion')
      await cacheManager.invalidateByPrefix('rag-query')
    } catch (error) {
      console.error('Failed to update document:', error)
      setDocuments((prev = []) =>
        (prev || []).map(doc =>
          doc.id === documentId
            ? {
                ...doc,
                processingStatus: 'error',
                errorMessage:
                  error instanceof Error ? error.message : 'Update failed'
              }
            : doc
        )
      )
    }
  }

  const NAV_ICON_SIZE = 18

  const navigationTabs = [
    {
      value: 'query',
      label: 'Query',
      icon: <ChatCircle size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <QueryInterface documents={documents || []} />
        </Suspense>
      )
    },
    {
      value: 'upload',
      label: 'Upload',
      icon: <FileText size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
        </Suspense>
      )
    },
    {
      value: 'integrations',
      label: 'Integrations',
      icon: <PlugsConnected size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <Integrations onDocumentsIngested={handleDocumentsIngested} />
        </Suspense>
      )
    },
    {
      value: 'knowledge',
      label: 'Knowledge',
      icon: <Brain size={NAV_ICON_SIZE} />,
      content: (
        <Suspense fallback={<LoadingSpinner />}>
          <DocumentList
            documents={documents || []}
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
          <ScalingDashboard documents={documents || []} />
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
