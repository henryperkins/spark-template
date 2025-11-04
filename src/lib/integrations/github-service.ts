import { GitHubRepo, Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'

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
    return response.json()
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
    const data = await response.json()
    
    if (data.content) {
      return atob(data.content.replace(/\n/g, ''))
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
    
    return data.tree
      .filter((item: unknown) => item.type === 'blob' && this.isTextFile(item.path))
      .map((item: unknown) => ({
        name: item.path.split('/').pop(),
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

  async ingestRepo(config: GitHubRepo): Promise<Document[]> {
    const { owner, repo, branch = 'main', path = '', token } = config
    
    try {
      let files = await this.getAllFilesViaTree(owner, repo, branch, token)
      if (path) {
        files = files.filter(f => f.path.startsWith(path))
      }
      const documents: Document[] = []
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        try {
          await this.delay(100)
          const content = await this.getFileContent(owner, repo, file.path, branch, token)
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
          
          documents.push(finalDocument)
          console.log(`Processed ${i + 1}/${files.length}: ${file.path}`)
        } catch (error) {
          console.error(`Failed to process file ${file.path}:`, error)
        }
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
      await this.getRepoContents(config.owner, config.repo, '', config.branch || 'main', config.token)
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
