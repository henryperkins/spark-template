import { OneDriveConfig, Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'
import { secureTokenStorage } from '@/lib/services/secure-token-storage'

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
       
      console.warn('[onedrive-service] Persist to /api/documents failed', resp.status, resp.statusText)
    }
  } catch (err) {
     
    console.warn('[onedrive-service] Persist to /api/documents error', err)
  }
}

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

interface TokenState {
  value: string
}

export class OneDriveService {
  private async fetchWithAuth(
    url: string,
    tokenState: TokenState,
    options: RequestInit = {},
    attempt = 0
  ): Promise<Response> {
    if (!tokenState.value) {
      throw new Error('OneDrive access token is missing')
    }

    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${tokenState.value}`)

    const response = await fetch(url, {
      ...options,
      headers
    })

    if (response.status === 401 && attempt === 0) {
      const refreshed = await this.refreshAccessToken(tokenState)
      if (refreshed) {
        tokenState.value = refreshed
        const retryHeaders = new Headers(options.headers)
        retryHeaders.set('Authorization', `Bearer ${tokenState.value}`)
        return this.fetchWithAuth(url, tokenState, { ...options, headers: retryHeaders }, attempt + 1)
      }
    }

    if (!response.ok) {
      throw new Error(`OneDrive API error: ${response.status} ${response.statusText}`)
    }

    return response
  }

  private async listFiles(tokenState: TokenState, path: string = ''): Promise<OneDriveItem[]> {
    const files: OneDriveItem[] = []
    let nextLink: string | undefined

    const encodedPath = encodeURIComponent(path || '/')
    const url = path
      ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/children`
      : 'https://graph.microsoft.com/v1.0/me/drive/root/children'

    do {
      const response = await this.fetchWithAuth(nextLink || url, tokenState)
      const data: OneDriveListResponse = await response.json()

      for (const item of data.value) {
        if (item.file && this.isTextFile(item.name)) {
          files.push(item)
        } else if (item.folder) {
          const childPath = path ? `${path}/${item.name}` : item.name
          const childFiles = await this.listFiles(tokenState, childPath)
          files.push(...childFiles)
        }
      }

      nextLink = data['@odata.nextLink']
    } while (nextLink)

    return files
  }

  private async downloadFile(tokenState: TokenState, item: OneDriveItem): Promise<string> {
    if (item['@microsoft.graph.downloadUrl']) {
      const response = await fetch(item['@microsoft.graph.downloadUrl'])
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`)
      }
      return response.text()
    }

    const response = await this.fetchWithAuth(
      `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`,
      tokenState
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
    if (!accessToken) {
      throw new Error('OneDrive access token is required')
    }

    const tokenState: TokenState = { value: accessToken }

    try {
      const files = await this.listFiles(tokenState, path)
      const documents: Document[] = []
      
      for (const file of files) {
        try {
          const content = await this.downloadFile(tokenState, file)
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
      throw new Error(`Failed to ingest OneDrive files: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async validateConfig(config: OneDriveConfig): Promise<{ valid: boolean; error?: string }> {
    const token = config.accessToken
    if (!token) {
      return { valid: false, error: 'Access token is required' }
    }

    try {
      await this.listFiles({ value: token }, config.path || '')
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token or unable to access files'
      }
    }
  }

  private async refreshAccessToken(tokenState: TokenState): Promise<string | null> {
    try {
      const response = await fetch('/api/oauth/onedrive/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        console.warn('[onedrive-service] Refresh request failed', response.status)
        return null
      }

      const data = await response.json().catch(() => null)
      const accessToken = typeof data?.accessToken === 'string' ? data.accessToken : null
      if (!accessToken) {
        console.warn('[onedrive-service] Refresh response missing access token')
        return null
      }

      if (typeof window !== 'undefined') {
        try {
          await secureTokenStorage.setToken('onedrive', accessToken)
        } catch (error) {
          console.warn('[onedrive-service] Unable to persist refreshed OneDrive token', error)
        }
      }

      tokenState.value = accessToken
      return accessToken
    } catch (error) {
      console.error('[onedrive-service] Refresh token request error', error)
      return null
    }
  }
}

export const oneDriveService = new OneDriveService()
