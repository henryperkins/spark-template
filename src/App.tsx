import React, { useEffect } from 'react'
import { useSparkKV } from '@/hooks/use-spark-kv'
import { ResponsiveNavigation } from '@/components/ResponsiveNavigation'
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
  const [documents, setDocuments] = useSparkKV<Document[]>('rag-documents', [])
  const [azureConfig] = useSparkKV<AzureConfig | null>('azure-config', null)

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

    setDocuments((prev = []) => prev.filter(doc => doc.id !== documentId))
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
          <div className="flex items-center gap-4">
            <Brain size={28} className="text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-foreground sm:text-4xl">Agentic RAG</h1>
              <p className="text-base text-muted-foreground sm:text-lg">Intelligent Knowledge Assistant</p>
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
