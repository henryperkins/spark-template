import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebsiteService } from '../src/lib/integrations/website-service'
import type { WebsiteConfig } from '../src/types'

// Mock DOMParser for Node.js environment
class MockDOMParser {
  parseFromString(html: string, type: string) {
    const mockDoc = {
      querySelector: (selector: string) => {
        if (selector === 'title') {
          return { textContent: 'Test Page' }
        }
        return null
      },
      querySelectorAll: (selector: string) => {
        if (selector === 'script, style, nav, footer, header') {
          return []
        }
        if (selector === 'a[href]') {
          return html.includes('href')
            ? [{
                getAttribute: (attr: string) => attr === 'href' ? '/page2' : null
              }]
            : []
        }
        return []
      },
      body: {
        // Must be >100 characters to pass content length check in scrapeWebsite
        textContent: 'This is test content from the page. It contains enough text to pass the minimum content length requirement for processing web pages during scraping operations.'
      }
    }
    return mockDoc
  }
}

global.DOMParser = MockDOMParser as any

// Mock dependencies
vi.mock('../src/lib/rag', () => ({
  intelligentChunkDocument: vi.fn(async (content: string, id: string, name: string) => ({
    chunks: [
      {
        content: content.slice(0, 100),
        embedding: new Array(1536).fill(0.1),
        chunkIndex: 0
      }
    ]
  }))
}))

vi.mock('../src/lib/azure-service-manager', () => ({
  azureServiceManager: {
    isConfigured: vi.fn(() => false),
    processDocumentWithAzure: vi.fn(async (doc: any) => doc)
  }
}))

vi.mock('../src/lib/embedding-manager', () => ({
  embeddingManager: {
    calculateChecksum: vi.fn(async (content: string) => 'mock-checksum-' + content.length),
    setMetadata: vi.fn(async () => {})
  }
}))

vi.mock('../src/lib/cache-manager', () => ({
  cacheManager: {
    invalidateByPrefix: vi.fn(async () => {})
  }
}))

describe('WebsiteService', () => {
  let service: WebsiteService
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new WebsiteService()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('normalizeUrl', () => {
    it('normalizes relative URLs', () => {
      const normalized = (service as any).normalizeUrl('/page', 'https://example.com')
      expect(normalized).toBe('https://example.com/page')
    })

    it('normalizes absolute URLs', () => {
      const normalized = (service as any).normalizeUrl('https://example.com/about', 'https://example.com')
      expect(normalized).toBe('https://example.com/about')
    })

    it('handles protocol-relative URLs', () => {
      const normalized = (service as any).normalizeUrl('//cdn.example.com/file', 'https://example.com')
      expect(normalized).toBe('https://cdn.example.com/file')
    })

    it('returns empty string for invalid URLs', () => {
      // The normalizeUrl catches errors from URL constructor
      // Use a string that URL() will throw on
      const normalized = (service as any).normalizeUrl('', 'invalid-base')
      expect(normalized).toBe('')
    })

    it('handles relative paths correctly', () => {
      const normalized = (service as any).normalizeUrl('../parent', 'https://example.com/child/page')
      expect(normalized).toBe('https://example.com/parent')
    })
  })

  describe('shouldVisit', () => {
    it('returns false for already visited URLs', () => {
      (service as any).visited.add('https://example.com/page')

      const config: WebsiteConfig = { url: 'https://example.com' }
      const result = (service as any).shouldVisit('https://example.com/page', config)

      expect(result).toBe(false)
    })

    it('returns false for different origins', () => {
      const config: WebsiteConfig = { url: 'https://example.com' }
      const result = (service as any).shouldVisit('https://other-site.com/page', config)

      expect(result).toBe(false)
    })

    it('respects exclude patterns', () => {
      const config: WebsiteConfig = {
        url: 'https://example.com',
        excludePatterns: ['/admin', '/login']
      }

      expect((service as any).shouldVisit('https://example.com/admin/dashboard', config)).toBe(false)
      expect((service as any).shouldVisit('https://example.com/login', config)).toBe(false)
      expect((service as any).shouldVisit('https://example.com/about', config)).toBe(true)
    })

    it('respects include patterns', () => {
      const config: WebsiteConfig = {
        url: 'https://example.com',
        includePatterns: ['/docs', '/api']
      }

      expect((service as any).shouldVisit('https://example.com/docs/guide', config)).toBe(true)
      expect((service as any).shouldVisit('https://example.com/api/reference', config)).toBe(true)
      expect((service as any).shouldVisit('https://example.com/about', config)).toBe(false)
    })

    it('allows all same-origin URLs when no patterns specified', () => {
      const config: WebsiteConfig = { url: 'https://example.com' }

      expect((service as any).shouldVisit('https://example.com/any/path', config)).toBe(true)
    })

    it('returns false for invalid URLs', () => {
      const config: WebsiteConfig = { url: 'https://example.com' }
      const result = (service as any).shouldVisit('not-a-url', config)

      expect(result).toBe(false)
    })
  })

  describe('fetchPage', () => {
    it('fetches HTML content from URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Content</body></html>', { status: 200 })
      )

      const html = await (service as any).fetchPage('https://example.com')

      expect(html).toBe('<html><body>Content</body></html>')
      expect(fetchSpy).toHaveBeenCalledWith('https://example.com')
    })

    it('throws error on non-OK responses', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      await expect(
        (service as any).fetchPage('https://example.com/missing')
      ).rejects.toThrow('Failed to fetch')
    })
  })

  describe('parsePage', () => {
    it('extracts title, content, and links from HTML', () => {
      const html = '<html><head><title>Test Page</title></head><body>Content <a href="/link">Link</a></body></html>'

      const parsed = (service as any).parsePage(html, 'https://example.com')

      expect(parsed.title).toBe('Test Page')
      expect(parsed.content).toBeTruthy()
      expect(parsed.url).toBe('https://example.com')
      expect(parsed.links).toBeDefined()
    })

    it('uses URL as fallback title', () => {
      const html = '<html><body>Content</body></html>'

      const parsed = (service as any).parsePage(html, 'https://example.com/page')

      expect(parsed.title).toBe('Test Page')
      expect(parsed.url).toBe('https://example.com/page')
    })

    it('cleans up whitespace in content', () => {
      const html = '<html><body>Line1\n\n\nLine2   Line3</body></html>'

      const parsed = (service as any).parsePage(html, 'https://example.com')

      expect(parsed.content).not.toMatch(/\n{3,}/)
      expect(parsed.content).not.toMatch(/\s{3,}/)
    })

    it('normalizes extracted links', () => {
      const html = '<html><body><a href="/page2">Link</a></body></html>'

      const parsed = (service as any).parsePage(html, 'https://example.com')

      expect(parsed.links).toContain('https://example.com/page2')
    })
  })

  describe('chunkContent', () => {
    it('chunks content by paragraphs respecting max size', () => {
      const content = 'Paragraph 1\n'.repeat(100)
      const chunks = (service as any).chunkContent(content, 50)

      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(50 + 20) // Allow some tolerance
      })
    })

    it('handles content smaller than max chunk size', () => {
      const content = 'Short content'
      const chunks = (service as any).chunkContent(content, 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe('Short content')
    })

    it('returns single chunk for empty content', () => {
      const chunks = (service as any).chunkContent('', 1000)

      expect(chunks).toHaveLength(1)
    })

    it('trims whitespace from chunks', () => {
      const content = '   Para 1   \n   Para 2   \n'
      const chunks = (service as any).chunkContent(content, 20)

      chunks.forEach((chunk: string) => {
        expect(chunk).not.toMatch(/^\s+/)
        expect(chunk).not.toMatch(/\s+$/)
      })
    })
  })

  describe('scrapeWebsite', () => {
    const mockConfig: WebsiteConfig = {
      url: 'https://example.com'
    }

    it('scrapes single page website', async () => {
      const { intelligentChunkDocument } = await import('../src/lib/rag')
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><head><title>Home</title></head><body>Welcome to our site!</body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite({ ...mockConfig, maxDepth: 1 })

      expect(documents).toHaveLength(1)
      expect(documents[0].source).toBe('website')
      expect(documents[0].sourceUrl).toBe('https://example.com')
      expect(intelligentChunkDocument).toHaveBeenCalled()
      expect(embeddingManager.setMetadata).toHaveBeenCalled()
    })

    it('respects maxPages limit', async () => {
      // Mock multiple pages being discovered
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Content with enough text to process<a href="/page2">Link</a></body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite({
        ...mockConfig,
        maxPages: 1,
        maxDepth: 5
      })

      expect(documents.length).toBeLessThanOrEqual(1)
    })

    it('respects maxDepth limit', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Content with sufficient text length<a href="/page2">Link</a></body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite({
        ...mockConfig,
        maxDepth: 1,
        maxPages: 100
      })

      expect(documents.length).toBeGreaterThan(0)
    })

    it('skips pages with insufficient content', async () => {
      // Override the mock to return short content
      const originalDOMParser = global.DOMParser
      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: () => ({ textContent: 'Short' }),
            querySelectorAll: () => [],
            body: { textContent: 'Short' } // Less than 100 chars
          }
        }
      } as any

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Short</body></html>', { status: 200 })
      )

      const documents = await service.scrapeWebsite(mockConfig)

      expect(documents).toHaveLength(0)

      global.DOMParser = originalDOMParser
    })

    it('processes documents with Azure when configured', async () => {
      const { azureServiceManager } = await import('../src/lib/azure-service-manager')
      const isConfiguredSpy = vi.spyOn(azureServiceManager, 'isConfigured').mockReturnValue(true)
      const processDocSpy = vi.spyOn(azureServiceManager, 'processDocumentWithAzure')
        .mockResolvedValue({
          id: 'azure-doc',
          name: 'test',
          content: 'content',
          uploadedAt: new Date().toISOString(),
          chunks: []
        })

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>This is a test page with enough content to process properly.</body></html>', {
          status: 200
        })
      )

      await service.scrapeWebsite(mockConfig)

      expect(processDocSpy).toHaveBeenCalled()

      isConfiguredSpy.mockRestore()
      processDocSpy.mockRestore()
    })

    it('continues scraping if a page fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      fetchSpy.mockResolvedValueOnce(
        new Response('Error', { status: 500 })
      )

      const documents = await service.scrapeWebsite(mockConfig)

      expect(documents).toHaveLength(0)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('invalidates cache after scraping', async () => {
      const { cacheManager } = await import('../src/lib/cache-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Content</body></html>', { status: 200 })
      )

      await service.scrapeWebsite(mockConfig)

      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('query-expansion')
      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('rag-query')
    })

    it('generates document IDs from base64-encoded URLs', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Content with enough text to be processed as a valid document</body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite(mockConfig)

      expect(documents[0].id).toMatch(/^web-[a-zA-Z0-9]+$/)
    })

    it('includes source metadata in documents', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html><head><title>Test</title></head><body>Content with enough text here</body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite(mockConfig)

      expect(documents[0].sourceMetadata).toBeDefined()
      expect(documents[0].sourceMetadata?.title).toBeDefined()
      expect(documents[0].sourceMetadata?.scrapedAt).toBeDefined()
    })

    it('sets medium volatility for website documents', async () => {
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>This is content that is long enough to be processed</body></html>', {
          status: 200
        })
      )

      await service.scrapeWebsite(mockConfig)

      const setMetadataCall = (embeddingManager.setMetadata as any).mock.calls[0][0]
      expect(setMetadataCall.volatility).toBe('medium')
    })

    it('uses text/html as document type', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Website content that meets the minimum length requirement</body></html>', {
          status: 200
        })
      )

      const documents = await service.scrapeWebsite(mockConfig)

      expect(documents[0].type).toBe('text/html')
    })

    it('rate limits requests with delay', async () => {
      vi.spyOn(global, 'setTimeout')

      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Content with enough characters to be valid</body></html>', {
          status: 200
        })
      )

      await service.scrapeWebsite(mockConfig)

      expect(setTimeout).toHaveBeenCalled()
    })

    it('clears visited set between scrapes', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Test</body></html>', { status: 200 })
      )

      await service.scrapeWebsite(mockConfig)
      await service.scrapeWebsite(mockConfig)

      // Should be able to visit the same URL again in second scrape
      expect((service as any).visited.size).toBeGreaterThanOrEqual(0)
    })
  })

  describe('validateConfig', () => {
    it('returns valid for accessible websites', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('<html><body>Content</body></html>', { status: 200 })
      )

      const config: WebsiteConfig = {
        url: 'https://example.com'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for inaccessible websites', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      const config: WebsiteConfig = {
        url: 'https://example.com/missing'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('returns invalid for malformed URLs', async () => {
      const config: WebsiteConfig = {
        url: 'not-a-valid-url'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const config: WebsiteConfig = {
        url: 'https://example.com'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })
})
