import React, { useState, useEffect } from 'react'
import { useSparkKV } from '@/hooks/use-spark-kv'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

        <Tabs defaultValue="query" className="space-y-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="query" className="flex items-center gap-2">
              <ChatCircle size={16} />
              Query
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <FileText size={16} />
              Upload
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-2">
              <PlugsConnected size={16} />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="flex items-center gap-2">
              <Brain size={16} />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="scaling" className="flex items-center gap-2">
              <ChartBar size={16} />
              Scaling
            </TabsTrigger>
            <TabsTrigger value="azure" className="flex items-center gap-2">
              <CloudArrowUp size={16} />
              Azure
            </TabsTrigger>
            <TabsTrigger value="architecture" className="flex items-center gap-2">
              <TreeStructure size={16} />
              Architecture
            </TabsTrigger>
          </TabsList>

          <TabsContent value="query" className="space-y-6">
            <QueryInterface documents={documents || []} />
          </TabsContent>

          <TabsContent value="upload" className="space-y-6">
            <DocumentUpload onDocumentUploaded={handleDocumentUploaded} />
          </TabsContent>

          <TabsContent value="integrations" className="space-y-6">
            <Integrations onDocumentsIngested={handleDocumentsIngested} />
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-6">
            <DocumentList 
              documents={documents || []} 
              onDeleteDocument={handleDeleteDocument}
            />
          </TabsContent>

          <TabsContent value="scaling" className="space-y-6">
            <ScalingDashboard documents={documents || []} />
          </TabsContent>

          <TabsContent value="azure" className="space-y-6">
            <AzureConfiguration />
          </TabsContent>

          <TabsContent value="architecture" className="space-y-6">
            <ArchitectureDiagram />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
