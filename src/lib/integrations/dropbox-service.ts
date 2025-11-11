import { DropboxConfig, Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'

// KV auth + persist helpers (mirror DocumentUpload logic)
function getKVAuthHeader(): Record<string, string> {
  try {
    const env: any = (import.meta as any)?.env
    const fromEnv = env?.VITE_KV_API_KEY as string | undefined
    let fromLocal: string | undefined
    if (typeof window !== 'undefined') {
      fromLocal = window.localStorage?.getItem('KV_API_KEY') ?? undefined
    }
    const token = fromLocal || fromEnv
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
async function persistDocumentToWorker(doc: Document): Promise<void> {
  try {
    const resp = await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getKVAuthHeader()
      },
      body: JSON.stringify({ document: doc })
    })
    if (!resp.ok) {
      // best-effort only
       
      console.warn('[dropbox-service] Persist to /api/documents failed', resp.status, resp.statusText)
    }
  } catch (err) {
     
    console.warn('[dropbox-service] Persist to /api/documents error', err)
  }
}

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

interface DropboxTokenState {
  value: string
}

export class DropboxService {
  private async fetchWithAuth(
    url: string,
    tokenState: DropboxTokenState,
    options: RequestInit = {},
    attempt = 0
  ): Promise<Response> {
    if (!tokenState.value) {
      throw new Error('Dropbox access token is missing')
    }

    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    headers.set('Authorization', `Bearer ${tokenState.value}`)

    const response = await fetch(url, {
      ...options,
      headers
    })

    if (response.status === 401 && attempt === 0) {
      const refreshed = await this.refreshAccessToken(tokenState)
      if (refreshed) {
        return this.fetchWithAuth(url, tokenState, options, attempt + 1)
      }
    }

    if (!response.ok) {
      throw new Error(`Dropbox API error: ${response.status} ${response.statusText}`)
    }

    return response
  }

  private async listFiles(tokenState: DropboxTokenState, path: string = ''): Promise<DropboxFile[]> {
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
  
      const response = await this.fetchWithAuth(url, tokenState, {
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

  private async downloadFile(tokenState: DropboxTokenState, path: string): Promise<string> {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenState.value}`,
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
      const tokenState: DropboxTokenState = { value: accessToken }
      const files = await this.listFiles(tokenState, path)
      const documents: Document[] = []
      
      for (const file of files) {
        try {
          const content = await this.downloadFile(tokenState, file.path_display)
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

          try {
            await persistDocumentToWorker(finalDocument)
          } catch {
            // best-effort
          }
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
      await this.listFiles({ value: config.accessToken }, config.path || '')
      return { valid: true }
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Invalid token or unable to access files'
      }
    }
  
    private async refreshAccessToken(tokenState: DropboxTokenState): Promise<boolean> {
      try {
        const resp = await fetch('/api/oauth/dropbox/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
  
        if (!resp.ok) {
          console.warn('[dropbox-service] Refresh request failed', resp.status)
          return false
        }
  
        const data = await resp.json().catch(() => null)
        const accessToken = typeof data?.accessToken === 'string' ? data.accessToken : null
        if (!accessToken) {
          console.warn('[dropbox-service] Refresh response missing access token')
          return false
        }
  
        if (typeof window !== 'undefined') {
          try {
            const { secureTokenStorage } = await import('@/lib/services/secure-token-storage')
            await secureTokenStorage.setToken('dropbox', accessToken)
          } catch (error) {
            console.warn('[dropbox-service] Unable to persist refreshed Dropbox token', error)
          }
        }
  
        tokenState.value = accessToken
        return true
      } catch (error) {
        console.error('[dropbox-service] Refresh token request error', error)
        return false
      }
    }
  }
}

export const dropboxService = new DropboxService()
