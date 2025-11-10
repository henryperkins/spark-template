import { GitHubRepo, Document } from '@/types'
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
       
      console.warn('[github-service] Persist to /api/documents failed', resp.status, resp.statusText)
    }
  } catch (err) {
     
    console.warn('[github-service] Persist to /api/documents error', err)
  }
}

/**
 * Robust base64 decoder that works in both browser and Node/vitest.
 * - Uses atob when available (browser/JSDOM)
 * - Falls back to Buffer in Node
 */
function decodeBase64(b64: string): string {
  try {
    const atobFn = (globalThis as any)?.atob as ((data: string) => string) | undefined
    if (typeof atobFn === 'function') {
      return atobFn(b64)
    }
  } catch {
    // fall through to Buffer
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8')
  }
  throw new Error('Base64 decode not available in this environment')
}

interface GitHubFile {
  name: string
  path: string
  type: string
  content?: string
  sha: string
  size: number
}

export class GitHubService {
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async resolveToken(provided?: string): Promise<string | undefined> {
    if (provided && provided.trim()) return provided
    
    // In test environments, skip KV entirely to keep unit tests hermetic
    if (typeof process !== 'undefined' && (process.env.VITEST || process.env.NODE_ENV === 'test')) {
      return undefined
    }
    
    try {
      const { runtime } = await import('@/lib/config')
      if (!runtime.isCloudflareWorkers()) {
        return undefined
      }
      const stored = await secureTokenStorage.getToken('github')
      return stored ?? undefined
    } catch (e) {
      console.warn('GitHubService: secure token lookup failed; continuing unauthenticated', e)
      return undefined
    }
  }

  private async fetchWithAuth(url: string, token?: string, retries = 3): Promise<Response> {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
    }
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    
    for (let i = 0; i < retries; i++) {
      const response = await fetch(url, { headers })
      
      if (response.ok) return response
      
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60')
        console.warn(`Rate limited. Waiting ${retryAfter}s...`)
        await this.delay(retryAfter * 1000)
        continue
      }
      
      if (i === retries - 1) {
        throw new Error(`GitHub API error: ${response.statusText}`)
      }
      
      await this.delay(1000 * Math.pow(2, i))
    }
    
    throw new Error('Max retries exceeded')
  }

  private async getRepoContents(
    owner: string,
    repo: string,
    path: string = '',
    branch: string = 'main',
    token?: string
  ): Promise<GitHubFile[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${branch !== 'main' ? `?ref=${branch}` : ''}`
    const response = await this.fetchWithAuth(url, token)
    const data = await response.json()

    // fetchWithAuth already throws on non-OK statuses, so reaching here means
    // the repo/path is accessible. We only need to normalize the shape:
    // - Directory listing: array
    // - Single file: object
    // - Anything else: treat as empty but non-fatal for accessibility checks.
    if (Array.isArray(data)) {
      return data as GitHubFile[]
    }

    if (data && typeof data === 'object' && (data as any).type === 'file') {
      return [data as GitHubFile]
    }

    return []
  }

  private async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch: string = 'main',
    token?: string
  ): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${branch !== 'main' ? `?ref=${branch}` : ''}`
    const response = await this.fetchWithAuth(url, token)
    const data = await response.json() as { content?: string }

    const raw = typeof data?.content === 'string' ? data.content.replace(/\n/g, '') : null
    if (raw) {
      return decodeBase64(raw)
    }

    throw new Error('No content found in file')
  }

  private async getAllFilesViaTree(
    owner: string,
    repo: string,
    branch: string = 'main',
    token?: string
  ): Promise<GitHubFile[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    const response = await this.fetchWithAuth(url, token)

    const data = await response.json()
    const tree = Array.isArray((data as any)?.tree)
      ? ((data as any).tree as Array<{ type: string; path: string; sha: string; size: number }>)
      : []
    return tree
      .filter((item) => item.type === 'blob' && this.isTextFile(item.path))
      .map((item) => ({
        name: item.path.split('/').pop() as string,
        path: item.path,
        type: 'file',
        sha: item.sha,
        size: item.size
      }))
  }

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      '.md', '.txt', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', 
      '.h', '.css', '.html', '.json', '.xml', '.yaml', '.yml', '.sh', '.bash',
      '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.sql',
      '.dockerfile', '.env', '.gitignore', '.toml', '.ini', '.cfg', '.conf'
    ]
    
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext)) || 
           !filename.includes('.')
  }

  async ingestRepo(config: GitHubRepo, onProgress?: (current: number, total: number, file: string) => void): Promise<Document[]> {
      const { owner, repo, branch = 'main', path = '', token } = config
        const resolvedToken = await this.resolveToken(token)
      try {
        let files = await this.getAllFilesViaTree(owner, repo, branch, resolvedToken)
        if (path) {
          files = files.filter(f => f.path.startsWith(path))
        }
        const total = files.length
        const documents: Document[] = []
        
        // Process files in parallel batches of 5 to respect rate limits
        const batchSize = 5
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize)
          const batchPromises = batch.map(async (file, batchIndex) => {
            try {
              const content = await this.getFileContent(owner, repo, file.path, branch, resolvedToken)
              const documentId = `github-${file.sha}`
              
              const { chunks } = await intelligentChunkDocument(content, documentId, file.name)
              
              const document: Document = {
                id: documentId,
                name: file.path,
                size: file.size,
                uploadedAt: new Date().toISOString(),
                type: 'text/plain',
                chunks,
                processed: true,
                processingStatus: 'pending',
                source: 'github',
                sourceUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${file.path}`,
                sourceMetadata: {
                  owner,
                  repo,
                  branch,
                  path: file.path,
                },
              }
  
              let finalDocument = document
  
              if (azureServiceManager.isConfigured()) {
                try {
                  finalDocument = await azureServiceManager.processDocumentWithAzure(document)
                } catch (error) {
                  console.error(`Azure processing failed for ${file.path}:`, error)
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
                volatility: 'low'
              })
              
              try {
                await persistDocumentToWorker(finalDocument)
              } catch {
                // best-effort
              }
              documents.push(finalDocument)
              const progress = i + batchIndex + 1
              console.log(`Processed ${progress}/${total}: ${file.path}`)
              onProgress?.(progress, total, file.path)
            } catch (error) {
              console.error(`Failed to process file ${file.path}:`, error)
            }
          })
          
          await Promise.all(batchPromises)
          // Small delay between batches to be nice to API
          await this.delay(1000)
        }
  
        await cacheManager.invalidateByPrefix('query-expansion')
        await cacheManager.invalidateByPrefix('rag-query')
        
        return documents
      } catch (error) {
        throw new Error(`Failed to ingest GitHub repo: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

  async validateConfig(config: GitHubRepo): Promise<{ valid: boolean; error?: string }> {
    try {
      const resolvedToken = await this.resolveToken(config.token)
      await this.getRepoContents(config.owner, config.repo, '', config.branch || 'main', resolvedToken)
      return { valid: true }
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

export const githubService = new GitHubService()
