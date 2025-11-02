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

  const navigationTabs = [
    {
      value: 'query',
      label: 'Query',
      icon: <ChatCircle size={20} />,
      content: <QueryInterface documents={documents || []} />
    },
    {
      value: 'upload',
      label: 'Upload',
      icon: <FileText size={20} />,
      content: <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
    },
    {
      value: 'integrations',
      label: 'Integrations',
      icon: <PlugsConnected size={20} />,
      content: <Integrations onDocumentsIngested={handleDocumentsIngested} />
    },
    {
      value: 'knowledge',
      label: 'Knowledge',
      icon: <Brain size={20} />,
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
      icon: <ChartBar size={20} />,
      content: <ScalingDashboard documents={documents || []} />
    },
    {
      value: 'azure',
      label: 'Azure',
      icon: <CloudArrowUp size={20} />,
      content: <AzureConfiguration />
    },
    {
      value: 'architecture',
      label: 'Architecture',
      icon: <TreeStructure size={20} />,
      content: <ArchitectureDiagram />
    }
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Brain size={32} className="text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-foreground">Agentic RAG</h1>
              <p className="text-muted-foreground">Intelligent Knowledge Assistant</p>
            </div>
          </div>
        </div>

        <ResponsiveNavigation
          tabs={navigationTabs}
          defaultValue="query"
          className="space-y-6"
        />
      </div>
    </div>
  )
}

export default App
