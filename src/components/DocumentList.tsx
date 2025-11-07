import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FileText, Trash, Clock, CloudArrowUp, XCircle, CircleNotch, GithubLogo, Globe, DropboxLogo, MicrosoftOutlookLogo, Upload } from '@phosphor-icons/react'
import { Document } from '@/types'
import { formatFileSize, formatDate } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'

interface DocumentListProps {
  documents: Document[]
  onDeleteDocument: (documentId: string) => void
}

export function DocumentList({ documents, onDeleteDocument }: DocumentListProps) {
  const getErrorSummary = (errorMessage: string) => {
    if (errorMessage.includes('400') || errorMessage.includes('request is invalid')) {
      return 'Azure Search API error - Invalid request format'
    }
    if (errorMessage.includes('Indexing failed')) {
      return 'Failed to index document to Azure Search'
    }
    if (errorMessage.includes('Load failed')) {
      return 'Failed to load document data'
    }
    return 'An error occurred during processing'
  }

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'github':
        return <GithubLogo size={14} />
      case 'website':
        return <Globe size={14} />
      case 'dropbox':
        return <DropboxLogo size={14} />
      case 'onedrive':
        return <MicrosoftOutlookLogo size={14} />
      default:
        return <Upload size={14} />
    }
  }

  const getSourceLabel = (source?: string) => {
    switch (source) {
      case 'github':
        return 'GitHub'
      case 'website':
        return 'Website'
      case 'dropbox':
        return 'Dropbox'
      case 'onedrive':
        return 'OneDrive'
      default:
        return 'Upload'
    }
  }

  const getProcessingStatusBadge = (document: Document) => {
    if (!azureServiceManager.isConfigured()) {
      return (
        <Badge variant="secondary" className="text-xs">
          <FileText size={12} className="mr-1" />
          Local
        </Badge>
      )
    }

    switch (document.processingStatus) {
      case 'processing':
        return (
          <Badge variant="secondary" className="text-xs">
            <CircleNotch size={12} className="mr-1 animate-spin" />
            Processing
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant="default" className="text-xs">
            <CloudArrowUp size={12} className="mr-1" />
            Azure Indexed
          </Badge>
        )
      case 'error':
        return (
          <Badge variant="destructive" className="text-xs">
            <XCircle size={12} className="mr-1" />
            Error
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-xs">
            <FileText size={12} className="mr-1" />
            Basic
          </Badge>
        )
    }
  }

  if (documents.length === 0) {
    return (
      <Card className="border-dashed bg-muted/40">
        <CardContent className="p-8 text-center space-y-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto">
            <FileText size={32} className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Your knowledge base is empty</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Ingest documents using the Upload and Integrations tabs. Once added, each document's
            chunks, embeddings, and Azure indexing status will appear here for full transparency.
          </p>
          <p className="text-xs text-muted-foreground">
            Tip: Start with 3–10 high-signal documents (architecture, runbooks, FAQs) to see the agentic
            workflow shine.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Knowledge base</h2>
          <p className="text-xs text-muted-foreground">
            Overview of all ingested documents, their source, processing status, and chunk coverage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {azureServiceManager.isConfigured() && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide flex items-center gap-1">
              <CloudArrowUp size={10} />
              Azure indexed
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            {documents.length} document{documents.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>
      
      {documents.map((document) => (
        <Card key={document.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileText size={18} className="text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">{document.name}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1.5">
                    <span className="whitespace-nowrap">{formatFileSize(document.size)}</span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Clock size={14} />
                      {formatDate(document.uploadedAt)}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {document.chunks.length} chunk{document.chunks.length !== 1 ? 's' : ''}
                      </Badge>
                      <Badge variant="secondary" className="text-xs flex items-center gap-1">
                        {getSourceIcon(document.source)}
                        {getSourceLabel(document.source)}
                      </Badge>
                      {getProcessingStatusBadge(document)}
                    </div>
                  </div>
                  {document.sourceUrl && (
                    <a 
                      href={document.sourceUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline mt-1 block"
                    >
                      View source →
                    </a>
                  )}
                  {document.errorMessage && (
                     <Collapsible className="mt-2">
                       <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-status-error hover:underline cursor-pointer">
                         <XCircle size={14} weight="fill" />
                         <span className="font-medium">
                           {getErrorSummary(document.errorMessage)}
                         </span>
                       </CollapsibleTrigger>
                       <CollapsibleContent className="mt-1.5">
                         <pre className="text-[10px] leading-snug bg-destructive/5 border border-destructive/20 rounded-md p-2 overflow-x-auto">
                           {document.errorMessage}
                         </pre>
                       </CollapsibleContent>
                     </Collapsible>
                   )}
                </div>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteDocument(document.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash size={16} />
              </Button>
            </div>
          </CardHeader>
          
          <CardContent className="pt-0">
            <Accordion type="single" collapsible>
              <AccordionItem value="chunks" className="border-none">
                <AccordionTrigger className="text-sm text-muted-foreground hover:no-underline py-2">
                  View document chunks
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 mt-2">
                    {document.chunks.map((chunk, index) => (
                      <div key={chunk.id} className="p-3 bg-muted rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Chunk {index + 1}
                            </Badge>
                            {chunk.azureEmbedding && (
                              <Badge variant="secondary" className="text-xs">
                                <CloudArrowUp size={10} className="mr-1" />
                                Embedded
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {chunk.content.length} characters
                          </span>
                        </div>
                        <p className="text-sm font-mono leading-relaxed">
                          {chunk.content.substring(0, 200)}
                          {chunk.content.length > 200 && '...'}
                        </p>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}