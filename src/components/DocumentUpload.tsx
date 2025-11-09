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

export function DocumentUpload({ onDocumentUploaded }: DocumentUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  
  // Chunked upload tuning
  const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
  const MAX_RETRIES = 3

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
      // Handle large files with chunked upload to avoid UI stalls (only when running behind Worker)
      // Note: chunk upload endpoint (/api/upload-chunk) only exists in worker/index.ts
      if (file.size > CHUNK_SIZE && runtime.isCloudflareWorkers()) {
        return await processLargeFile(file, documentId, updateProgress)
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
      updateProgress(100, 'error', error instanceof Error ? error.message : 'Unknown error')
      throw error
    }

    /**
     * Chunked upload pipeline for large files (Worker mode only).
     *
     * Flow:
     * 1. Upload chunks via /api/upload-chunk (stored in KV with 1hr TTL)
     * 2. Call /api/upload-complete to assemble chunks and cleanup
     * 3. Read file locally for ingestion (keeps existing pipeline stable)
     *
     * This exercises the worker chunk assembly while maintaining backward-compatible
     * ingestion behavior. Future work can move ingestion server-side.
     */
    async function processLargeFile(
      file: File,
      docId: string,
      progressFn: (progress: number, status: UploadProgress['status'], error?: string) => void
    ): Promise<Document> {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      let uploaded = 0

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const blob = file.slice(start, end)

        let retries = 0
        // Exponential backoff retry
        while (retries < MAX_RETRIES) {
          try {
            await uploadChunk(blob, docId, i)
            uploaded++
            const pct = Math.min(90, 10 + Math.floor((uploaded / totalChunks) * 80))
            progressFn(pct, 'processing')
            break
          } catch (err) {
            retries++
            if (retries === MAX_RETRIES) {
              throw new Error(`Failed to upload chunk ${i + 1} after ${MAX_RETRIES} attempts`)
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * retries))
          }
        }
      }

      // Notify worker to assemble chunks
      const finalizeResp = await fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: docId,
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          totalChunks,
        }),
      })

      if (!finalizeResp.ok) {
        const message = await finalizeResp.text().catch(() => '')
        throw new Error(
          `Failed to finalize upload: ${finalizeResp.status} ${finalizeResp.statusText}` +
          (message ? ` - ${message}` : ''),
        )
      }

      // For now, still read locally so ingestion uses existing pipeline.
      // This keeps behavior stable while exercising the worker endpoint.
      const content = await readLargeFile(file)
      return await processContent(
        content,
        docId,
        file.name,
        file.size,
        file.type || 'text/plain',
        progressFn,
      )
    }

    async function uploadChunk(chunk: Blob, documentId: string, chunkIndex: number): Promise<void> {
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('documentId', documentId)
      formData.append('chunkIndex', String(chunkIndex))

      const resp = await fetch('/api/upload-chunk', { method: 'POST', body: formData })
      if (!resp.ok) {
        throw new Error(`Chunk upload failed: ${resp.status} ${resp.statusText}`)
      }
    }

    async function readLargeFile(file: File): Promise<string> {
      return file.type === 'application/pdf'
        ? await extractTextFromPdf(file)
        : await file.text()
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
  }, [onDocumentUploaded])

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
