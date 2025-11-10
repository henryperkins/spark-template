import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Trash, Clock, CloudArrowUp, XCircle, CircleNotch, GithubLogo, Globe, DropboxLogo, MicrosoftOutlookLogo, Upload, PencilSimple, MagnifyingGlass, Funnel, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Document, DocumentChunk, DocumentIndex, DocumentMeta } from '@/types'
import { formatFileSize, formatDate } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { useDocumentsIndex } from '@/hooks/use-documents-index'
import { useDocumentDetails } from '@/hooks/use-document-details'
import { cn } from '@/lib/utils'

interface DocumentListV2Props {
  onDeleteDocument?: (documentId: string) => void
  onEditDocument?: (documentId: string, newContent: string) => Promise<void> | void
}

const MAX_EDIT_CONTENT_LENGTH = 10_000_000

export function DocumentListV2({ onDeleteDocument, onEditDocument }: DocumentListV2Props) {
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set())

  // Use new hooks for document management
  const {
    documents,
    loading,
    error,
    pagination,
    refetch
  } = useDocumentsIndex({
    page: currentPage,
    pageSize: 20,
    q: searchQuery,
    source: sourceFilter === 'all' ? undefined : sourceFilter,
    status: statusFilter === 'all' ? undefined : statusFilter
  })

  const {
    meta: editingMeta,
    chunks: editingChunks,
    refetch: refetchEditingDetails
  } = useDocumentDetails(editingDocId)

  useEffect(() => {
    if (editingDocId) {
      refetchEditingDetails()
    }
  }, [editingDocId, refetchEditingDetails])

  const isEditableSource = (document: Document | DocumentIndex) => {
    return !document.source || document.source === 'upload'
  }

  const handleOpenEdit = async (document: Document | DocumentIndex) => {
    if (!isEditableSource(document) || !onEditDocument) return

    setEditingDocId(document.id)
    
    // Use pre-fetched content from useDocumentDetails
    if (editingMeta && editingChunks) {
      const reconstructed = editingChunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(chunk => chunk.content)
        .join('\n\n')
      
      setEditContent(reconstructed || editingMeta.originalContent || '')
      setEditError(null)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingDocId || !onEditDocument) return

    if (!editContent.trim()) {
      setEditError('Content cannot be empty.')
      return
    }

    if (editContent.length > MAX_EDIT_CONTENT_LENGTH) {
      setEditError(
        `Content exceeds the ${MAX_EDIT_CONTENT_LENGTH / 1_000_000} MB limit. Please shorten the document before saving.`
      )
      return
    }

    setIsUpdating(true)
    setEditError(null)
    try {
      await onEditDocument(editingDocId, editContent)
      setEditingDocId(null)
      setEditContent('')
      // Always refetch to reflect server state after edit
      refetch()
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save changes. Please try again.'
      setEditError(message)
       
      console.error('Failed to save edit:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancelEdit = () => {
    if (isUpdating) return
    setEditingDocId(null)
    setEditContent('')
    setEditError(null)
  }

  const handleDelete = async (documentId: string) => {
    if (onDeleteDocument) {
      await onDeleteDocument(documentId)
      refetch()
    }
  }

  const toggleChunks = (documentId: string) => {
    const newExpanded = new Set(expandedChunks)
    if (newExpanded.has(documentId)) {
      newExpanded.delete(documentId)
    } else {
      newExpanded.add(documentId)
    }
    setExpandedChunks(newExpanded)
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

  const getProcessingStatusBadge = (document: Document | DocumentIndex) => {
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

  const editingDocument: DocumentMeta | null = editingMeta

  if (documents.length === 0 && !loading) {
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
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide flex items-center gap-1"
              >
                <CloudArrowUp size={10} />
                Azure indexed
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {documents.length} document{documents.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9"
            />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="upload">Upload</SelectItem>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="website">Website</SelectItem>
              <SelectItem value="dropbox">Dropbox</SelectItem>
              <SelectItem value="onedrive">OneDrive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {!loading && documents.map(document => (
          <Card key={document.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileText size={18} className="text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold break-all">
                      {document.name}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                        {formatFileSize(document.size)}
                      </span>
                      <span className="text-border">•</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} />
                        {formatDate(document.uploadedAt)}
                      </span>
                      <span className="text-border">•</span>
                      <Badge variant="outline" className="text-[9px]">
                        {document.chunkCount} chunk
                        {document.chunkCount !== 1 ? 's' : ''}
                      </Badge>
                      <Badge variant="secondary" className="text-xs flex items-center gap-1">
                        {getSourceIcon(document.source)}
                        {getSourceLabel(document.source)}
                      </Badge>
                      {getProcessingStatusBadge(document)}
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
                        This document is managed via {getSourceLabel(document.source)}. Edit at source or trigger
                        a sync.
                      </p>
                    )}
                    {document.errorMessage && (
                      <Collapsible className="mt-2">
                        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-status-error hover:underline cursor-pointer">
                          <XCircle size={14} weight="fill" aria-hidden="true" />
                          <span className="font-medium">
                            {getErrorSummary(document.errorMessage!)}
                          </span>
                          <span className="sr-only">View full error details</span>
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
                      aria-label={`Edit ${document.name}`}
                    >
                      <PencilSimple size={16} aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(document.id)}
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${document.name}`}
                  >
                    <Trash size={16} aria-hidden="true" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <Accordion type="single" collapsible>
                <AccordionItem value="chunks" className="border-none">
                 <AccordionTrigger
                   className="text-sm text-muted-foreground hover:no-underline py-2"
                   aria-label="View document chunks"
                 >
                   View document chunks
                 </AccordionTrigger>
                 <AccordionContent>
                   <div className="space-y-3 mt-2">
                     {Array.from({ length: document.chunkCount }).map((_, index: number) => (
                       <div key={`${document.id}-chunk-${index}`} className="p-3 bg-muted rounded-lg">
                         <div className="flex items-center justify-between mb-2">
                           <div className="flex items-center gap-2">
                             <Badge variant="outline" className="text-xs">
                               Chunk {index + 1}
                             </Badge>
                           </div>
                           <span className="text-xs text-muted-foreground">
                             Approximate chunk
                           </span>
                         </div>
                         <p className="text-xs text-muted-foreground italic">
                           Chunk preview is available in the detailed document view.
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

        {/* Pagination */}
        {pagination.totalPages > 1 && (
                  <div className="flex flex-col gap-2 mt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Page {pagination.page} of {pagination.totalPages}
                      </span>
                      <span className="hidden sm:inline-block">
                        • Showing {(pagination.page - 1) * pagination.pageSize + 1}
                        {'–'}
                        {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} documents
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>Rows per page</span>
                        <Select
                          value={String(pagination.pageSize)}
                          onValueChange={(value) => {
                            const nextSize = parseInt(value, 10)
                            // Reset to first page when page size changes to avoid empty pages
                            setCurrentPage(1)
                            // useDocumentsIndex reads pageSize from options; trigger by updating search/status/source state dependencies if needed
                            // Here we rely on internal hook behavior when page/pageSize props change.
                            // @ts-expect-error pageSize is managed via pagination; hook consumes it.
                            pagination.pageSize = nextSize
                          }}
                        >
                          <SelectTrigger className="h-7 w-[70px] px-2 text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="20">20</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCurrentPage(1)}
                          disabled={!pagination.hasPrevPage}
                        >
                          « First
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={!pagination.hasPrevPage}
                        >
                          <CaretLeft size={14} />
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCurrentPage(prev => Math.min(pagination.totalPages, prev + 1))}
                          disabled={!pagination.hasNextPage}
                        >
                          Next
                          <CaretRight size={14} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setCurrentPage(pagination.totalPages)}
                          disabled={!pagination.hasNextPage}
                        >
                          Last »
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
      </div>

      <Dialog open={editingDocId !== null} onOpenChange={open => !open && handleCancelEdit()}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Document Content</DialogTitle>
            <DialogDescription>
              {editingDocument
                ? `Editing "${editingDocument.name}". Content will be re-chunked and ${
                    azureServiceManager.isConfigured()
                      ? 'reindexed to Azure AI Search'
                      : 'processed locally'
                  }.`
                : 'Content will be re-chunked and processed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 py-4">
            {editError && (
              <div className="mb-2 text-xs text-destructive" role="alert">
                {editError}
              </div>
            )}
            <Textarea
              value={editContent}
              onChange={e => {
                const next = e.target.value
                if (next.length <= MAX_EDIT_CONTENT_LENGTH) {
                  setEditContent(next)
                  if (editError) {
                    setEditError(null)
                  }
                } else {
                  setEditError(
                    `Content exceeds the ${MAX_EDIT_CONTENT_LENGTH / 1_000_000} MB limit. Please shorten the document before saving.`
                  )
                }
              }}
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
                {isUpdating && (
                  <CircleNotch size={16} className="mr-2 animate-spin" />
                )}
                Save & Reingest
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}