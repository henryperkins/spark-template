import { useEffect } from 'react'
import { useStorage } from '@/hooks/use-kv'
import { ResponsiveNavigation } from '@/components/ResponsiveNavigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { DocumentUpload } from '@/components/DocumentUpload'
import { DocumentList } from '@/components/DocumentList'
import { QueryInterface } from '@/components/QueryInterface'
import { AzureConfiguration } from '@/components/AzureConfiguration'
import { ScalingDashboard } from '@/components/ScalingDashboard'
import { Integrations } from '@/components/Integrations'
import { ArchitectureDiagram } from '@/components/ArchitectureDiagram'
import { Document, AzureConfig } from '@/types'
import { Brain, FileText, ChatCircle, CloudArrowUp, ChartBar, PlugsConnected, TreeStructure } from '@phosphor-icons/react'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cacheManager } from '@/lib/cache-manager'

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
      content: <QueryInterface documents={documents || []} />
    },
    {
      value: 'upload',
      label: 'Upload',
      icon: <FileText size={NAV_ICON_SIZE} />,
      content: <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
    },
    {
      value: 'integrations',
      label: 'Integrations',
      icon: <PlugsConnected size={NAV_ICON_SIZE} />,
      content: <Integrations onDocumentsIngested={handleDocumentsIngested} />
    },
    {
      value: 'knowledge',
      label: 'Knowledge',
      icon: <Brain size={NAV_ICON_SIZE} />,
      content: (
        <DocumentList
          documents={documents || []}
          onDeleteDocument={handleDeleteDocument}
        />
      )
    },
    {
      value: 'scaling',
      label: 'Scaling',
      icon: <ChartBar size={NAV_ICON_SIZE} />,
      content: <ScalingDashboard documents={documents || []} />
    },
    {
      value: 'azure',
      label: 'Azure',
      icon: <CloudArrowUp size={NAV_ICON_SIZE} />,
      content: <AzureConfiguration />
    },
    {
      value: 'architecture',
      label: 'Architecture',
      icon: <TreeStructure size={NAV_ICON_SIZE} />,
      content: <ArchitectureDiagram />
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
