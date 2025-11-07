import React, { useState, useCallback } from 'react'
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

interface DocumentUploadProps {
  onDocumentUploaded: (document: Document) => void
}

interface UploadProgress {
  fileName: string
  progress: number
  status: 'processing' | 'embedding' | 'indexing' | 'completed' | 'error'
  error?: string
}

export function DocumentUpload({ onDocumentUploaded }: DocumentUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])

  const processFile = async (file: File): Promise<Document> => {
    const documentId = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Update progress
    const updateProgress = (progress: number, status: UploadProgress['status'], error?: string) => {
      setUploadProgress(prev => 
        prev.map(p => 
          p.fileName === file.name 
            ? { ...p, progress, status, error }
            : p
        )
      )
    }

    updateProgress(10, 'processing')

    try {
      const content = await file.text()
      updateProgress(25, 'processing')

      const { chunks } = await intelligentChunkDocument(content, documentId, file.name)
      updateProgress(40, 'processing')

      const document: Document = {
        id: documentId,
        name: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        type: file.type || 'text/plain',
        chunks,
        processed: true,
        processingStatus: 'pending'
      }

      let finalDocument = document

      if (azureServiceManager.isConfigured()) {
        updateProgress(50, 'embedding')
        finalDocument = await azureServiceManager.processDocumentWithAzure(document)
        
        if (finalDocument.processingStatus === 'completed') {
          updateProgress(90, 'indexing')
          await new Promise(resolve => setTimeout(resolve, 500))
          updateProgress(100, 'completed')
        } else {
          updateProgress(100, 'error', finalDocument.errorMessage)
        }
      } else {
        updateProgress(100, 'completed')
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
    } catch (error) {
      updateProgress(100, 'error', error instanceof Error ? error.message : 'Unknown error')
      throw error
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

  return (
    <div className="space-y-6">
      <Card className={cn(
        "border-dashed border-2 transition-colors cursor-pointer",
        dragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
      )}>
        <CardContent className="p-5 sm:p-8">
          <div
            className="text-center space-y-4"
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
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
              <label htmlFor="file-upload" className="flex cursor-pointer items-center justify-center gap-2">
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
