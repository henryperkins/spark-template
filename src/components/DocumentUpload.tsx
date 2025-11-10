import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { FileText, Upload, CloudArrowUp, CheckCircle, XCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cacheManager } from '@/lib/cache-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { extractTextFromPdf } from '@/lib/pdf'
import { isCloudflareKVConfigured } from '@/lib/cloudflare-kv'
import { runtime } from '@/lib/config'
import { useUploadQueue } from '@/hooks/use-upload-queue'
import { errorTracking } from '@/lib/services/error-tracker'

interface DocumentUploadProps {
  onDocumentUploaded: (document: Document) => void
}

interface UploadProgress {
  fileName: string
  progress: number
  status: 'processing' | 'embedding' | 'indexing' | 'completed' | 'error'
  error?: string
}

 // 20 MB limit by default to avoid browser memory spikes and timeouts
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

function getKVAuthHeader(): Record<string, string> {
  const env: any = (import.meta as any)?.env
  const fromEnv = env?.VITE_KV_API_KEY as string | undefined
  let fromLocal: string | undefined
  if (typeof window !== 'undefined') {
    fromLocal = window.localStorage?.getItem('KV_API_KEY') ?? undefined
  }
  const token = fromLocal || fromEnv
  console.log('[getKVAuthHeader] Token:', token) // Debug log
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function persistDocumentToWorker(doc: Document): Promise<void> {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...getKVAuthHeader()
    }
    console.log('[persistDocumentToWorker] Headers:', headers) // Debug log
    const resp = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ document: doc })
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.warn('[DocumentUpload] Persist to /api/documents failed', resp.status, resp.statusText, text)
    }
  } catch (err) {
    console.warn('[DocumentUpload] Persist to /api/documents error', err)
  }
}

export function DocumentUpload({ onDocumentUploaded }: DocumentUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])

  // Resumable upload queue (Phase 4 - F7)
  const { addFile } = useUploadQueue()

  const processFile = async (file: File): Promise<Document> => {
    const documentId = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Update progress
    const updateProgress = (progress: number, status: UploadProgress['status'], error?: string) => {
      setUploadProgress(prev =>
        prev.map(p =>
          (file?.name ? p.fileName === file.name : false)
            ? { ...p, progress, status, error }
            : p
        )
      )
    }

    updateProgress(10, 'processing')

    try {
      // For large files on Workers, prefer resumable queue so uploads survive refresh
      if (file.size > 5 * 1024 * 1024 && runtime.isCloudflareWorkers()) {
        // Enqueue file; actual chunk uploads handled by useUploadQueue + processQueue.
        await addFile(file)
        updateProgress(5, 'processing')

        // Create and persist a placeholder so it appears in the index while upload finalizes
        const placeholder: Document = {
          id: documentId,
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          type: file.type || 'application/octet-stream',
          chunks: [],
          processed: false,
          processingStatus: 'pending'
        }
        try {
          await persistDocumentToWorker(placeholder)
        } catch {
          // best-effort only
        }
        return placeholder
      }

      // Small files: read directly and process
      const content =
        file.type === 'application/pdf'
          ? await extractTextFromPdf(file)
          : await file.text()
      if (!content || content.trim().length === 0) {
        throw new Error(file.type === 'application/pdf'
          ? 'Could not extract text from PDF'
          : 'Empty file content')
      }
      return await processContent(content, documentId, file.name, file.size, file.type || 'text/plain', updateProgress)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      updateProgress(100, 'error', message)
      errorTracking.record(error as Error, {
        type: 'runtime',
        agent: 'DocumentUpload',
        code: 'process_file_failed',
        metadata: {
          fileName: file.name
        }
      })
      throw error
    }

    async function processContent(
      content: string,
      docId: string,
      fileName: string,
      fileSize: number,
      fileType: string,
      progressFn: (progress: number, status: UploadProgress['status'], error?: string) => void
    ): Promise<Document> {
      if (!content || content.trim().length === 0) {
        throw new Error('Empty file content')
      }

      progressFn(25, 'processing')
      const { chunks } = await intelligentChunkDocument(content, docId, fileName)
      progressFn(40, 'processing')

      const document: Document = {
        id: docId,
        name: fileName,
        size: fileSize,
        uploadedAt: new Date().toISOString(),
        type: fileType || 'text/plain',
        chunks,
        processed: true,
        processingStatus: 'pending'
      }

      let finalDocument = document

      if (azureServiceManager.isConfigured()) {
        progressFn(50, 'embedding')
        finalDocument = await azureServiceManager.processDocumentWithAzure(document, (done, total) => {
          // Map embedding progress (50% → 80%)
          const frac = total > 0 ? done / total : 0
          const pct = Math.min(80, 50 + Math.floor(frac * 30))
          progressFn(pct, 'embedding')
        })

        if (finalDocument.processingStatus === 'completed') {
          progressFn(80, 'indexing')
          await new Promise(resolve => setTimeout(resolve, 500))
          progressFn(100, 'completed')
        } else {
          progressFn(100, 'error', finalDocument.errorMessage)
        }
      } else {
        // Local mode
        progressFn(100, 'completed')
      }

      await embeddingManager.setMetadata({
        version: 'v2025.01',
        lastRefreshed: new Date().toISOString(),
        checksum: await embeddingManager.calculateChecksum(content),
        modelVersion: 'text-embedding-ada-002',
        chunkCount: chunks.length,
        documentId: finalDocument.id,
        documentName: finalDocument.name,
        volatility: 'medium'
      })

      await cacheManager.invalidateByPrefix('query-expansion')
      await cacheManager.invalidateByPrefix('rag-query')

      // Persist to Worker so DocumentListV2 (index API) reflects this upload
      try {
        await persistDocumentToWorker(finalDocument)
      } catch {
        // best-effort only; UI remains optimistic
      }

      return finalDocument
    }
  }

  const handleFiles = useCallback(async (files: FileList) => {
    setUploading(true)
    
    // Initialize progress tracking
    const initialProgress = Array.from(files).map(file => ({
      fileName: file.name,
      progress: 0,
      status: 'processing' as const
    }))
    setUploadProgress(initialProgress)

    const processedDocuments: Document[] = []

    for (const file of Array.from(files)) {
      if (file.type === 'text/plain' || file.type === 'application/pdf' || file.name.endsWith('.md')) {
        // File size guard
        if (file.size > MAX_FILE_SIZE_BYTES) {
          setUploadProgress(prev =>
            prev.map(p =>
              p.fileName === file.name
                ? {
                    ...p,
                    progress: 100,
                    status: 'error',
                    error: `File exceeds ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB limit`
                  }
                : p
            )
          )
          continue
        }
        try {
          const document = await processFile(file)
          processedDocuments.push(document)
          onDocumentUploaded(document)
        } catch (error) {
          console.error('Error processing file:', error)
        }
      }
    }
    
    // Clear progress after a delay
    setTimeout(() => {
      setUploadProgress([])
      setUploading(false)
    }, 2000)
  }, [onDocumentUploaded, processFile])

  const getStatusIcon = (status: UploadProgress['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-status-success" size={16} />
      case 'error':
        return <XCircle className="text-status-error" size={16} />
      case 'embedding':
      case 'indexing':
        return <CloudArrowUp className="text-status-info" size={16} />
      default:
        return <FileText className="text-muted-foreground" size={16} />
    }
  }

  const getStatusText = (status: UploadProgress['status']) => {
    switch (status) {
      case 'processing':
        return 'Processing content'
      case 'embedding':
        return 'Generating embeddings'
      case 'indexing':
        return 'Indexing in Azure'
      case 'completed':
        return 'Completed'
      case 'error':
        return 'Error'
      default:
        return 'Processing'
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files)
    }
  }, [handleFiles])

  const handleDropzoneClick = useCallback(() => {
    if (!uploading) {
      document.getElementById('file-upload')?.click()
    }
  }, [uploading])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl sm:text-2xl font-semibold">Upload documents</h2>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
          Add source files to your knowledge base. Content is chunked intelligently and, when configured,
          enriched and indexed by Azure for high-quality retrieval.
        </p>
      </div>
      <Card
        className={cn(
          "border-dashed border-2 transition-colors cursor-pointer bg-muted/40",
          dragActive
            ? "border-accent bg-accent/5 shadow-sm"
            : "border-border/70 hover:border-accent/60 hover:bg-muted/60"
        )}
      >
        <CardContent className="p-5 sm:p-6 lg:p-7">
          <div
            className="text-center space-y-4"
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={handleDropzoneClick}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center text-muted-foreground sm:h-14 sm:w-14">
              {uploading ? (
                <div className="h-full w-full animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <Upload size={40} />
              )}
            </div>
            
            <h3 className="text-lg font-semibold sm:text-xl">
              {uploading ? 'Processing documents...' : 'Upload Documents'}
            </h3>
            
            <p className="text-sm text-muted-foreground sm:text-base">
              Drag and drop files here, or click to select
            </p>
            
            <p className="text-sm text-muted-foreground sm:text-base">
              Supports: .txt, .md, .pdf files
              {azureServiceManager.isConfigured() && (
                <Badge variant="outline" className="ml-2">
                  <CloudArrowUp size={12} className="mr-1" />
                  Azure Enhanced
                </Badge>
              )}
            </p>
            {!isCloudflareKVConfigured() && (
              <p className="text-xs text-muted-foreground">
                Tip: Enable Cloudflare KV in .env to persist large knowledge bases (local storage has ~5MB limit).
              </p>
            )}
            
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,text/plain,application/pdf"
              onChange={handleChange}
              className="hidden"
              id="file-upload"
              disabled={uploading}
            />
            
            <Button asChild disabled={uploading} className="w-full sm:w-auto">
              <label
                htmlFor="file-upload"
                className="flex cursor-pointer items-center justify-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <FileText className="shrink-0" size={16} />
                Select Files
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>

      {uploadProgress.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h4 className="font-medium mb-4">Upload Progress</h4>
            <div className="space-y-4">
              {uploadProgress.map((progress) => (
                <div key={progress.fileName} className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {getStatusIcon(progress.status)}
                      <span className="truncate text-sm font-medium">{progress.fileName}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {getStatusText(progress.status)}
                      </span>
                      <Badge
                        variant={progress.status === 'completed' ? 'default' : progress.status === 'error' ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {progress.progress}%
                      </Badge>
                    </div>
                  </div>
                  <Progress value={progress.progress} className="h-2" />
                  {progress.error && (
                    <p className="text-xs text-status-error">{progress.error}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
