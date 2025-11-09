import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { FileText, Trash, Clock, CloudArrowUp, XCircle, CircleNotch, GithubLogo, Globe, DropboxLogo, MicrosoftOutlookLogo, Upload, PencilSimple } from '@phosphor-icons/react'
import { Document, DocumentChunk } from '@/types'
import { formatFileSize, formatDate } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { useVirtualizedDocuments } from '@/hooks/use-virtualized-documents'

interface DocumentListProps {
  documents: Document[]
  onDeleteDocument: (documentId: string) => void
  onEditDocument?: (documentId: string, newContent: string) => void
}

export function DocumentList({ documents, onDeleteDocument, onEditDocument }: DocumentListProps) {
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  
  const { visibleDocuments, hasMore, totalCount, windowStart, windowEnd } = useVirtualizedDocuments(documents, { windowSize: 50 })

  const isEditableSource = (document: Document) => {
    return !document.source || document.source === 'upload'
  }

  const handleOpenEdit = (document: Document) => {
    if (!isEditableSource(document) || !onEditDocument) return

    // IMPORTANT:
    // We must not reconstruct the editable text by naively concatenating chunk.content.
    // Chunking strategies in [`src/lib/rag.intelligentChunkDocument()`](src/lib/rag.ts:15)
    // intentionally introduce overlaps between chunks, so joining them directly would:
    // - Duplicate overlapping spans
    // - Inflate content on every edit/reingest
    // - Corrupt retrieval quality
    //
    // Instead, we derive an editable approximation that de-duplicates overlaps while
    // preserving user-visible ordering. This keeps the edit flow safe without requiring
    // storage of the original raw text.
    const sortedChunks = (document.chunks || []).slice().sort((a, b) => a.chunkIndex - b.chunkIndex)

    let reconstructed = ''
    let lastTail = ''

    for (const chunk of sortedChunks) {
      const content = (chunk.content || '').trim()
      if (!content) continue

      if (!reconstructed) {
        // First chunk: take as-is.
        reconstructed = content
      } else {
        // Try to find the longest reasonable overlap between the previous tail
        // and the current chunk start, and only append the non-overlapping suffix.
        const maxOverlap = Math.min(lastTail.length, content.length, 300)
        let overlapLength = 0

        for (let len = maxOverlap; len > 20; len--) {
          const tailSlice = lastTail.slice(-len)
          const headSlice = content.slice(0, len)
          if (tailSlice === headSlice) {
            overlapLength = len
            break
          }
        }

        if (overlapLength > 0) {
          reconstructed += content.slice(overlapLength)
        } else {
          // Fallback: join with a paragraph break if no clean overlap is detected.
          reconstructed += (reconstructed.endsWith('\n') ? '\n' : '\n\n') + content
        }
      }

      // Track tail window from the updated reconstructed text for subsequent overlap checks.
      lastTail = reconstructed.slice(-300)
    }

    const safeText = reconstructed || ('originalContent' in document ? (document as Document & { originalContent: string }).originalContent : '') || ''

    setEditContent(safeText)
    setEditingDocId(document.id)
  }

  const handleSaveEdit = async () => {
    if (!editingDocId || !onEditDocument) return

    setIsUpdating(true)
    try {
      await onEditDocument(editingDocId, editContent)
      setEditingDocId(null)
      setEditContent('')
    } catch (error) {
      console.error('Failed to save edit:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingDocId(null)
    setEditContent('')
  }

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

  const editingDocument = documents.find(d => d.id === editingDocId)

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
    <>
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

        {visibleDocuments.map((document) => (
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
                    {!isEditableSource(document) && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                        This document is managed via {getSourceLabel(document.source)}. Edit at source or trigger a sync.
                      </p>
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

                <div className="flex items-center gap-2">
                  {isEditableSource(document) && onEditDocument && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(document)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <PencilSimple size={16} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteDocument(document.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
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
                      {document.chunks.map((chunk: DocumentChunk, index: number) => (
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

      {hasMore && (
        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
          Showing {visibleDocuments.length} of {totalCount} documents (latest {windowStart + 1}–{windowEnd})
        </div>
      )}
      {/* Edit Dialog */}
      <Dialog open={editingDocId !== null} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Document Content</DialogTitle>
            <DialogDescription>
              Editing "{editingDocument?.name}". Content will be re-chunked and
              {azureServiceManager.isConfigured() ? ' reindexed to Azure AI Search' : ' processed locally'}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 py-4">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              disabled={isUpdating}
              className="w-full h-full min-h-[300px] font-mono text-sm resize-none"
              placeholder="Document content..."
            />
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 text-xs text-muted-foreground">
              {editContent.length.toLocaleString()} characters • Changes will trigger immediate reingestion
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCancelEdit}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={isUpdating || !editContent.trim()}
              >
                {isUpdating && <CircleNotch size={16} className="mr-2 animate-spin" />}
                Save & Reingest
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
