import { DropboxConfig, Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'

interface DropboxFile {
  '.tag': string
  name: string
  path_display: string
  id: string
  size: number
}

interface DropboxListResponse {
  entries: DropboxFile[]
  cursor?: string
  has_more: boolean
}

export class DropboxService {
  private async fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    
    if (!response.ok) {
      throw new Error(`Dropbox API error: ${response.statusText}`)
    }
    
    return response
  }

  private async listFiles(token: string, path: string = ''): Promise<DropboxFile[]> {
    const files: DropboxFile[] = []
    let hasMore = true
    let cursor: string | undefined
    
    while (hasMore) {
      const url = cursor 
        ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
        : 'https://api.dropboxapi.com/2/files/list_folder'
      
      const body = cursor 
        ? { cursor }
        : { path: path || '', recursive: true }
      
      const response = await this.fetchWithAuth(url, token, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      
      const data: DropboxListResponse = await response.json()
      
      const textFiles = data.entries.filter(entry => 
        entry['.tag'] === 'file' && this.isTextFile(entry.name)
      )
      
      files.push(...textFiles)
      hasMore = data.has_more
      cursor = data.cursor
    }
    
    return files
  }

  private async downloadFile(token: string, path: string): Promise<string> {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    })
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`)
    }
    
    return response.text()
  }

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      '.md', '.txt', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
      '.h', '.css', '.html', '.json', '.xml', '.yaml', '.yml', '.sh', '.bash',
      '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.sql',
      '.csv', '.log', '.env', '.toml', '.ini', '.cfg', '.conf'
    ]
    
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext))
  }

  private chunkContent(content: string, maxChunkSize: number = 1000): string[] {
    const chunks: string[] = []
    const lines = content.split('\n')
    let currentChunk = ''
    
    for (const line of lines) {
      if ((currentChunk + line).length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = line + '\n'
      } else {
        currentChunk += line + '\n'
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }
    
    return chunks.length > 0 ? chunks : [content]
  }

  async ingestFiles(config: DropboxConfig): Promise<Document[]> {
    const { accessToken, path = '' } = config
    
    try {
      const files = await this.listFiles(accessToken, path)
      const documents: Document[] = []
      
      for (const file of files) {
        try {
          const content = await this.downloadFile(accessToken, file.path_display)
          const documentId = `dropbox-${file.id.replace(/[^a-zA-Z0-9]/g, '')}`
          
          const { chunks } = await intelligentChunkDocument(content, documentId, file.name)
          
          const document: Document = {
            id: documentId,
            name: file.name,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            type: 'text/plain',
            chunks,
            processed: true,
            processingStatus: 'pending',
            source: 'dropbox',
            sourceUrl: file.path_display,
            sourceMetadata: {
              path: file.path_display,
              syncedAt: new Date().toISOString(),
            },
          }

          let finalDocument = document

          if (azureServiceManager.isConfigured()) {
            try {
              finalDocument = await azureServiceManager.processDocumentWithAzure(document)
            } catch (error) {
              console.error(`Azure processing failed for ${file.name}:`, error)
            }
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

          documents.push(finalDocument)
        } catch (error) {
          console.error(`Failed to process file ${file.name}:`, error)
        }
      }

      await cacheManager.invalidateByPrefix('query-expansion')
      await cacheManager.invalidateByPrefix('rag-query')
      
      return documents
    } catch (error) {
      throw new Error(`Failed to ingest Dropbox files: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async validateConfig(config: DropboxConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listFiles(config.accessToken, config.path || '')
      return { valid: true }
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Invalid token or unable to access files'
      }
    }
  }
}

export const dropboxService = new DropboxService()
