import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneDriveService } from '../src/lib/integrations/onedrive-service'
import type { OneDriveConfig } from '../src/types'

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

describe('OneDriveService', () => {
  let service: OneDriveService
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new OneDriveService()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchWithAuth', () => {
    it('makes authenticated requests with Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      await (service as any).fetchWithAuth('https://graph.microsoft.com/v1.0/test', 'test-token')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/test',
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
        (service as any).fetchWithAuth('https://graph.microsoft.com/v1.0/test', 'bad-token')
      ).rejects.toThrow('OneDrive API error')
    })

    it('merges custom headers with Authorization', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )

      await (service as any).fetchWithAuth('https://graph.microsoft.com/v1.0/test', 'token', {
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
          value: [
            { id: '123', name: 'test.txt', size: 100, file: { mimeType: 'text/plain' } },
            { id: '456', name: 'folder', size: 0, folder: {} }
          ]
        }), { status: 200 })
      )

      // Mock recursive call for folder
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: []
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('test.txt')
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/drive/root/children',
        expect.any(Object)
      )
    })

    it('lists files from specific path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: []
        }), { status: 200 })
      )

      await (service as any).listFiles('token', 'documents/work')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('documents%2Fwork'),
        expect.any(Object)
      )
    })

    it('recursively traverses folders', async () => {
      // Root level
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '1', name: 'file1.txt', size: 100, file: { mimeType: 'text/plain' } },
            { id: '2', name: 'subfolder', size: 0, folder: {} }
          ]
        }), { status: 200 })
      )

      // Subfolder
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '3', name: 'file2.txt', size: 200, file: { mimeType: 'text/plain' } }
          ]
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(2)
      expect(files[0].name).toBe('file1.txt')
      expect(files[1].name).toBe('file2.txt')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('handles pagination with @odata.nextLink', async () => {
      // First page
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '1', name: 'file1.txt', size: 100, file: { mimeType: 'text/plain' } }
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next'
        }), { status: 200 })
      )

      // Second page
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '2', name: 'file2.txt', size: 200, file: { mimeType: 'text/plain' } }
          ]
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(2)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(fetchSpy.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/next')
    })

    it('filters out non-text files', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '1', name: 'document.txt', size: 100, file: { mimeType: 'text/plain' } },
            { id: '2', name: 'image.png', size: 500, file: { mimeType: 'image/png' } },
            { id: '3', name: 'script.js', size: 300, file: { mimeType: 'application/javascript' } }
          ]
        }), { status: 200 })
      )

      const files = await (service as any).listFiles('token')

      expect(files).toHaveLength(2)
      expect(files.some((f: any) => f.name === 'image.png')).toBe(false)
    })
  })

  describe('downloadFile', () => {
    it('downloads file using direct download URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('File content', { status: 200 })
      )

      const item = {
        id: '123',
        name: 'test.txt',
        size: 100,
        '@microsoft.graph.downloadUrl': 'https://download.example.com/file'
      }

      const content = await (service as any).downloadFile('token', item)

      expect(content).toBe('File content')
      expect(fetchSpy).toHaveBeenCalledWith('https://download.example.com/file')
    })

    it('downloads file using item ID when no download URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('File content via API', { status: 200 })
      )

      const item = {
        id: '123',
        name: 'test.txt',
        size: 100
      }

      const content = await (service as any).downloadFile('token', item)

      expect(content).toBe('File content via API')
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/drive/items/123/content',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token'
          })
        })
      )
    })

    it('throws error on download failure with direct URL', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      const item = {
        id: '123',
        name: 'test.txt',
        size: 100,
        '@microsoft.graph.downloadUrl': 'https://download.example.com/missing'
      }

      await expect(
        (service as any).downloadFile('token', item)
      ).rejects.toThrow('Failed to download file')
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
        expect(chunk.length).toBeLessThanOrEqual(50 + 10)
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
    const mockConfig: OneDriveConfig = {
      accessToken: 'test-token'
    }

    it('ingests text files from OneDrive', async () => {
      const { intelligentChunkDocument } = await import('../src/lib/rag')
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      // Mock list files
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: 'abc123', name: 'doc1.txt', size: 100, file: { mimeType: 'text/plain' } }
          ]
        }), { status: 200 })
      )

      // Mock download (using direct URL)
      fetchSpy.mockResolvedValueOnce(
        new Response('Document content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents).toHaveLength(1)
      expect(documents[0].source).toBe('onedrive')
      expect(documents[0].sourceUrl).toContain('onedrive.live.com')
      expect(intelligentChunkDocument).toHaveBeenCalled()
      expect(embeddingManager.setMetadata).toHaveBeenCalled()
    })

    it('processes files with custom path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: []
        }), { status: 200 })
      )

      const configWithPath: OneDriveConfig = {
        accessToken: 'token',
        path: 'documents/work'
      }

      await service.ingestFiles(configWithPath)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('documents%2Fwork'),
        expect.any(Object)
      )
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
          value: [
            { id: '123', name: 'test.txt', size: 50, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.example.com/file' }
          ]
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
          value: [
            { id: '1', name: 'good.txt', size: 100, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.com/good' },
            { id: '2', name: 'bad.txt', size: 200, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.com/bad' }
          ]
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
          value: []
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

      await expect(service.ingestFiles(mockConfig)).rejects.toThrow('Failed to ingest OneDrive files')
    })

    it('sanitizes file IDs for document IDs', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: 'ABC-123_XYZ!456', name: 'test.txt', size: 100, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.com/file' }
          ]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      // Should start with onedrive- prefix
      expect(documents[0].id).toBe('onedrive-ABC123XYZ456')
      // Original ID special characters should be removed
      expect(documents[0].id).toMatch(/^onedrive-[a-zA-Z0-9]+$/)
      expect(documents[0].id).not.toContain('_')
      expect(documents[0].id).not.toContain('!')
    })

    it('includes source metadata in documents', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: 'xyz789', name: 'doc.txt', size: 150, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.com/doc' }
          ]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents[0].sourceMetadata).toBeDefined()
      expect(documents[0].sourceMetadata?.itemId).toBe('xyz789')
      expect(documents[0].sourceMetadata?.syncedAt).toBeDefined()
    })

    it('uses MIME type from file metadata', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '123', name: 'data.json', size: 100, file: { mimeType: 'application/json' }, '@microsoft.graph.downloadUrl': 'https://dl.com/data' }
          ]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('{"key": "value"}', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents[0].type).toBe('application/json')
    })

    it('defaults to text/plain when no MIME type available', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '123', name: 'file.txt', size: 100, file: {}, '@microsoft.graph.downloadUrl': 'https://dl.com/file' }
          ]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response('Content', { status: 200 })
      )

      const documents = await service.ingestFiles(mockConfig)

      expect(documents[0].type).toBe('text/plain')
    })

    it('sets medium volatility for OneDrive documents', async () => {
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: [
            { id: '123', name: 'test.txt', size: 100, file: { mimeType: 'text/plain' }, '@microsoft.graph.downloadUrl': 'https://dl.com/test' }
          ]
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
    it('returns valid for accessible OneDrive accounts', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: []
        }), { status: 200 })
      )

      const config: OneDriveConfig = {
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

      const config: OneDriveConfig = {
        accessToken: 'invalid-token'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('validates with custom path', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          value: []
        }), { status: 200 })
      )

      const config: OneDriveConfig = {
        accessToken: 'token',
        path: 'documents/work'
      }

      await service.validateConfig(config)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('documents%2Fwork'),
        expect.any(Object)
      )
    })

    it('handles network errors gracefully', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'))

      const config: OneDriveConfig = {
        accessToken: 'token'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })
})
