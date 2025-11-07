import { WebsiteConfig, Document } from '@/types'
import { intelligentChunkDocument } from '@/lib/rag'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'

interface ParsedPage {
  url: string
  title: string
  content: string
  links: string[]
}

export class WebsiteService {
  private visited: Set<string> = new Set()
  private queue: string[] = []

  private normalizeUrl(url: string, baseUrl: string): string {
    try {
      return new URL(url, baseUrl).href
    } catch {
      return ''
    }
  }

  private shouldVisit(url: string, config: WebsiteConfig): boolean {
    if (this.visited.has(url)) return false
    
    try {
      const urlObj = new URL(url)
      const baseUrlObj = new URL(config.url)
      
      if (urlObj.origin !== baseUrlObj.origin) return false
      
      if (config.excludePatterns?.some(pattern => url.includes(pattern))) {
        return false
      }
      
      if (config.includePatterns && config.includePatterns.length > 0) {
        return config.includePatterns.some(pattern => url.includes(pattern))
      }
      
      return true
    } catch {
      return false
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
    }
    
    return response.text()
  }

  private parsePage(html: string, url: string): ParsedPage {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    
    const title = doc.querySelector('title')?.textContent || url
    
    const scripts = doc.querySelectorAll('script, style, nav, footer, header')
    scripts.forEach(el => el.remove())
    
    const content = doc.body?.textContent || ''
    const cleanContent = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
    
    const links: string[] = []
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href')
      if (href) {
        const normalized = this.normalizeUrl(href, url)
        if (normalized) links.push(normalized)
      }
    })
    
    return { url, title, content: cleanContent, links }
  }

  private chunkContent(content: string, maxChunkSize: number = 1000): string[] {
    const chunks: string[] = []
    const paragraphs = content.split('\n')
    let currentChunk = ''
    
    for (const para of paragraphs) {
      if ((currentChunk + para).length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = para + '\n'
      } else {
        currentChunk += para + '\n'
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }
    
    return chunks.length > 0 ? chunks : [content]
  }

  async scrapeWebsite(config: WebsiteConfig): Promise<Document[]> {
    const { url, maxDepth = 2, maxPages = 50 } = config
    
    this.visited.clear()
    this.queue = [url]
    
    const documents: Document[] = []
    let depth = 0
    
    while (this.queue.length > 0 && depth < maxDepth && this.visited.size < maxPages) {
      const currentLevelSize = this.queue.length
      const nextQueue: string[] = []
      
      for (let i = 0; i < currentLevelSize && this.visited.size < maxPages; i++) {
        const currentUrl = this.queue.shift()
        if (!currentUrl || this.visited.has(currentUrl)) continue
        
        try {
          this.visited.add(currentUrl)
          const html = await this.fetchPage(currentUrl)
          const parsed = this.parsePage(html, currentUrl)
          
          if (parsed.content.length > 100) {
            const docId = `web-${btoa(currentUrl).substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`
            
            const { chunks } = await intelligentChunkDocument(parsed.content, docId, parsed.title)
            
            const document: Document = {
              id: docId,
              name: parsed.title,
              size: parsed.content.length,
              uploadedAt: new Date().toISOString(),
              type: 'text/html',
              chunks,
              processed: true,
              processingStatus: 'pending',
              source: 'website',
              sourceUrl: currentUrl,
              sourceMetadata: {
                title: parsed.title,
                scrapedAt: new Date().toISOString(),
              },
            }

            let finalDocument = document

            if (azureServiceManager.isConfigured()) {
              try {
                finalDocument = await azureServiceManager.processDocumentWithAzure(document)
              } catch (error) {
                console.error(`Azure processing failed for ${currentUrl}:`, error)
              }
            }

            await embeddingManager.setMetadata({
              version: 'v2025.01',
              lastRefreshed: new Date().toISOString(),
              checksum: await embeddingManager.calculateChecksum(parsed.content),
              modelVersion: 'text-embedding-ada-002',
              chunkCount: chunks.length,
              documentId: finalDocument.id,
              documentName: finalDocument.name,
              volatility: 'medium'
            })

            documents.push(finalDocument)
          }
          
          parsed.links.forEach(link => {
            if (this.shouldVisit(link, config)) {
              nextQueue.push(link)
            }
          })
          
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`Failed to scrape ${currentUrl}:`, error)
        }
      }
      
      this.queue = nextQueue
      depth++
    }

    await cacheManager.invalidateByPrefix('query-expansion')
    await cacheManager.invalidateByPrefix('rag-query')
    
    return documents
  }

  async validateConfig(config: WebsiteConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      new URL(config.url)
      await this.fetchPage(config.url)
      return { valid: true }
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Invalid URL or unable to fetch'
      }
    }
  }
}

export const websiteService = new WebsiteService()
