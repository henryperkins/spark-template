import { OneDriveConfig, Document, DocumentChunk } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'

interface OneDriveItem {
  id: string
  name: string
  size: number
  file?: {
    mimeType: string
  }
  folder?: object
  '@microsoft.graph.downloadUrl'?: string
}

interface OneDriveListResponse {
  value: OneDriveItem[]
  '@odata.nextLink'?: string
}

export class OneDriveService {
  private async fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    })
    
    if (!response.ok) {
      throw new Error(`OneDrive API error: ${response.statusText}`)
    }
    
    return response
  }

  private async listFiles(token: string, path: string = ''): Promise<OneDriveItem[]> {
    const files: OneDriveItem[] = []
    let nextLink: string | undefined
    
    const encodedPath = encodeURIComponent(path || '/')
    let url = path 
      ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/children`
      : 'https://graph.microsoft.com/v1.0/me/drive/root/children'
    
    do {
      const response = await this.fetchWithAuth(nextLink || url, token)
      const data: OneDriveListResponse = await response.json()
      
      for (const item of data.value) {
        if (item.file && this.isTextFile(item.name)) {
          files.push(item)
        } else if (item.folder) {
          const childPath = path ? `${path}/${item.name}` : item.name
          const childFiles = await this.listFiles(token, childPath)
          files.push(...childFiles)
        }
      }
      
      nextLink = data['@odata.nextLink']
    } while (nextLink)
    
    return files
  }

  private async downloadFile(token: string, item: OneDriveItem): Promise<string> {
    if (item['@microsoft.graph.downloadUrl']) {
      const response = await fetch(item['@microsoft.graph.downloadUrl'])
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`)
      }
      return response.text()
    }
    
    const response = await this.fetchWithAuth(
      `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`,
      token
    )
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

  async ingestFiles(config: OneDriveConfig): Promise<Document[]> {
    const { accessToken, path = '' } = config
    
    try {
      const files = await this.listFiles(accessToken, path)
      const documents: Document[] = []
      
      for (const file of files) {
        try {
          const content = await this.downloadFile(accessToken, file)
          const documentId = `onedrive-${file.id.replace(/[^a-zA-Z0-9]/g, '')}`
          
          const { chunks } = await intelligentChunkDocument(content, documentId, file.name)
          
          const document: Document = {
            id: documentId,
            name: file.name,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            type: file.file?.mimeType || 'text/plain',
            chunks,
            processed: true,
            processingStatus: 'pending',
            source: 'onedrive',
            sourceUrl: `https://onedrive.live.com/?cid=${file.id}`,
            sourceMetadata: {
              itemId: file.id,
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
      throw new Error(`Failed to ingest OneDrive files: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async validateConfig(config: OneDriveConfig): Promise<{ valid: boolean; error?: string }> {
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

export const oneDriveService = new OneDriveService()
