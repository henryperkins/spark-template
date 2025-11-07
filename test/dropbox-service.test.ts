import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DropboxService } from '../src/lib/integrations/dropbox-service'
import type { DropboxConfig } from '../src/types'

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

describe('DropboxService', () => {
  let service: DropboxService
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new DropboxService()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchWithAuth', () => {
    it('makes authenticated requests with Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      await (service as any).fetchWithAuth('https://api.dropboxapi.com/2/test', 'test-token')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.dropboxapi.com/2/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      )
    })

    it('throws error on non-OK responses', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      await expect(
        (service as any).fetchWithAuth('https://api.dropboxapi.com/2/test', 'bad-token')
      ).rejects.toThrow('Dropbox API error')
    })

    it('includes Content-Type header by default', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )

      await (service as any).fetchWithAuth('https://api.dropboxapi.com/2/test', 'token')

      const callArgs = fetchSpy.mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>

      expect(headers['Content-Type']).toBe('application/json')
    })

    it('merges custom headers with defaults', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )

      await (service as any).fetchWithAuth('https://api.dropboxapi.com/2/test', 'token', {
        headers: { 'Custom-Header': 'value' }
      })

      const callArgs = fetchSpy.mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>

      expect(headers['Authorization']).toBe('Bearer token')
      expect(headers['Custom-Header']).toBe('value')
    })
  })

  describe('listFiles', () => {
    it('lists files from root directory', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'test.txt', path_display: '/test.txt', id: 'id:abc', size: 100 },
            { '.tag': 'folder', name: 'folder', path_display: '/folder', id: 'id:def', size: 0 }
          ],
          has_more: false
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('test.txt')
    })

    it('lists files from specific path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [],
          has_more: false
        }), { status: 200 })
      )

      await (service as any).listFiles('token', '/documents')

      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
      expect(requestBody.path).toBe('/documents')
      expect(requestBody.recursive).toBe(true)
    })

    it('handles pagination with cursor', async () => {
      // First page
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'file1.txt', path_display: '/file1.txt', id: 'id:1', size: 100 }
          ],
          has_more: true,
          cursor: 'cursor-123'
        }), { status: 200 })
      )

      // Second page
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'file2.txt', path_display: '/file2.txt', id: 'id:2', size: 200 }
          ],
          has_more: false
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(2)
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      // Second call should use continue endpoint
      expect(fetchSpy.mock.calls[1][0]).toContain('list_folder/continue')
      const secondRequestBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string)
      expect(secondRequestBody.cursor).toBe('cursor-123')
    })

    it('filters out non-text files', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'document.txt', path_display: '/document.txt', id: 'id:1', size: 100 },
            { '.tag': 'file', name: 'image.png', path_display: '/image.png', id: 'id:2', size: 500 },
            { '.tag': 'file', name: 'script.js', path_display: '/script.js', id: 'id:3', size: 300 }
          ],
          has_more: false
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(2)
      expect(files.some((f: any) => f.name === 'image.png')).toBe(false)
    })

    it('filters out folders', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'file.txt', path_display: '/file.txt', id: 'id:1', size: 100 },
            { '.tag': 'folder', name: 'my-folder', path_display: '/my-folder', id: 'id:2', size: 0 }
          ],
          has_more: false
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(1)
      expect(files[0]['.tag']).toBe('file')
    })
  })

  describe('downloadFile', () => {
    it('downloads file content', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('File content here', { status: 200 })
      )

      const content = await (service as any).downloadFile('token', '/test.txt')

      expect(content).toBe('File content here')
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://content.dropboxapi.com/2/files/download',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token',
            'Dropbox-API-Arg': JSON.stringify({ path: '/test.txt' })
          })
        })
      )
    })

    it('throws error on download failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      await expect(
        (service as any).downloadFile('token', '/missing.txt')
      ).rejects.toThrow('Failed to download file')
    })

    it('uses content API endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('content', { status: 200 })
      )

      await (service as any).downloadFile('token', '/file.txt')

      expect(fetchSpy.mock.calls[0][0]).toBe('https://content.dropboxapi.com/2/files/download')
    })
  })

  describe('isTextFile', () => {
    it('identifies common text file extensions', () => {
      const testCases = [
        'document.txt',
        'README.md',
        'script.js',
        'style.css',
        'data.json',
        'config.yaml',
        'log.csv'
      ]

      testCases.forEach(filename => {
        expect((service as any).isTextFile(filename)).toBe(true)
      })
    })

    it('rejects binary file extensions', () => {
      const testCases = [
        'image.jpg',
        'video.mp4',
        'archive.zip',
        'binary.exe',
        'document.pdf'
      ]

      testCases.forEach(filename => {
        expect((service as any).isTextFile(filename)).toBe(false)
      })
    })

    it('is case insensitive', () => {
      expect((service as any).isTextFile('FILE.TXT')).toBe(true)
      expect((service as any).isTextFile('Script.JS')).toBe(true)
      expect((service as any).isTextFile('IMAGE.PNG')).toBe(false)
    })
  })

  describe('chunkContent', () => {
    it('chunks content by lines respecting max size', () => {
      const content = 'Line 1\n'.repeat(100)
      const chunks = (service as any).chunkContent(content, 50)

      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(50 + 10) // Allow some tolerance
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
      const content = '   Line 1   \n   Line 2   \n'
      const chunks = (service as any).chunkContent(content, 20)

      chunks.forEach((chunk: string) => {
        expect(chunk).not.toMatch(/^\s+/)
        expect(chunk).not.toMatch(/\s+$/)
      })
    })
  })

  describe('ingestFiles', () => {
    const mockConfig: DropboxConfig = {
      accessToken: 'test-token'
    }

    it('ingests text files from Dropbox', async () => {
      const { intelligentChunkDocument } = await import('../src/lib/rag')
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      // Mock list files
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'doc1.txt', path_display: '/doc1.txt', id: 'id:abc', size: 100 }
          ],
          has_more: false
        }), { status: 200 })
      )

      // Mock download
      fetchSpy.mockResolvedValueOnce(
        new Response('Document content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents).toHaveLength(1)
      expect(documents[0].source).toBe('dropbox')
      expect(documents[0].sourceUrl).toBe('/doc1.txt')
      expect(intelligentChunkDocument).toHaveBeenCalled()
      expect(embeddingManager.setMetadata).toHaveBeenCalled()
    })

    it('processes files with custom path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [],
          has_more: false
        }), { status: 200 })
      )

      const configWithPath: DropboxConfig = {
        accessToken: 'token',
        path: '/documents'
      }

      await service.ingestFiles(configWithPath)

      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
      expect(requestBody.path).toBe('/documents')
    })

    it('processes documents with Azure when configured', async () => {
      const { azureServiceManager } = await import('../src/lib/azure-service-manager')
      const isConfiguredSpy = vi.spyOn(azureServiceManager, 'isConfigured').mockReturnValue(true)
      const processDocSpy = vi.spyOn(azureServiceManager, 'processDocumentWithAzure')
        .mockResolvedValue({
          id: 'azure-doc',
          name: 'test.txt',
          content: 'content',
          uploadedAt: new Date().toISOString(),
          chunks: []
        })

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'test.txt', path_display: '/test.txt', id: 'id:123', size: 50 }
          ],
          has_more: false
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Test content', { status: 200 })
      )

      await service.ingestFiles(mockConfig)

      expect(processDocSpy).toHaveBeenCalled()

      isConfiguredSpy.mockRestore()
      processDocSpy.mockRestore()
    })

    it('continues processing if a file fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'good.txt', path_display: '/good.txt', id: 'id:1', size: 100 },
            { '.tag': 'file', name: 'bad.txt', path_display: '/bad.txt', id: 'id:2', size: 200 }
          ],
          has_more: false
        }), { status: 200 })
      )

      // First file succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response('Good content', { status: 200 })
      )

      // Second file fails
      fetchSpy.mockResolvedValueOnce(
        new Response('Error', { status: 500 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents).toHaveLength(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('invalidates cache after ingestion', async () => {
      const { cacheManager } = await import('../src/lib/cache-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [],
          has_more: false
        }), { status: 200 })
      )

      await service.ingestFiles(mockConfig)

      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('query-expansion')
      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('rag-query')
    })

    it('throws error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      await expect(service.ingestFiles(mockConfig)).rejects.toThrow('Failed to ingest Dropbox files')
    })

    it('sanitizes file IDs for document IDs', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'test.txt', path_display: '/test.txt', id: 'id:abc-123_xyz', size: 100 }
          ],
          has_more: false
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      // Should start with dropbox- prefix
      expect(documents[0].id).toMatch(/^dropbox-[a-zA-Z0-9]+$/)
      // Original ID special characters should be removed
      expect(documents[0].id).toBe('dropbox-idabc123xyz')
      expect(documents[0].id).not.toContain(':')
      expect(documents[0].id).not.toContain('_')
    })

    it('includes source metadata in documents', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'doc.txt', path_display: '/folder/doc.txt', id: 'id:xyz', size: 150 }
          ],
          has_more: false
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents[0].sourceMetadata).toBeDefined()
      expect(documents[0].sourceMetadata?.path).toBe('/folder/doc.txt')
      expect(documents[0].sourceMetadata?.syncedAt).toBeDefined()
    })

    it('sets medium volatility for Dropbox documents', async () => {
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', name: 'test.txt', path_display: '/test.txt', id: 'id:123', size: 100 }
          ],
          has_more: false
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      await service.ingestFiles(mockConfig)

      const setMetadataCall = (embeddingManager.setMetadata as any).mock.calls[0][0]
      expect(setMetadataCall.volatility).toBe('medium')
    })
  })

  describe('validateConfig', () => {
    it('returns valid for accessible Dropbox accounts', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [],
          has_more: false
        }), { status: 200 })
      )

      const config: DropboxConfig = {
        accessToken: 'valid-token'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for inaccessible accounts', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Invalid token', { status: 401 })
      )

      const config: DropboxConfig = {
        accessToken: 'invalid-token'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('validates with custom path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          entries: [],
          has_more: false
        }), { status: 200 })
      )

      const config: DropboxConfig = {
        accessToken: 'token',
        path: '/documents'
      }

      await service.validateConfig(config)

      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
      expect(requestBody.path).toBe('/documents')
    })

    it('handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const config: DropboxConfig = {
        accessToken: 'token'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })
})
