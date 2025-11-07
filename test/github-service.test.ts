import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitHubService } from '../src/lib/integrations/github-service'
import type { GitHubRepo } from '../src/types'

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

describe('GitHubService', () => {
  let service: GitHubService
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new GitHubService()
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchWithAuth', () => {
    it('makes authenticated requests with token', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      // Access the private method via casting
      const result = await (service as any).fetchWithAuth(
        'https://api.github.com/repos/test/repo',
        'test-token'
      )

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/test/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      )
      expect(result.ok).toBe(true)
    })

    it('makes requests without token when not provided', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      )

      await (service as any).fetchWithAuth('https://api.github.com/repos/test/repo')

      const callArgs = fetchSpy.mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>

      expect(headers['Authorization']).toBeUndefined()
    })

    it('handles rate limiting with retry', async () => {
      // First call: rate limited
      fetchSpy.mockResolvedValueOnce(
        new Response('Rate Limited', {
          status: 429,
          headers: { 'Retry-After': '1' }
        })
      )

      // Second call: success
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      )

      const result = await (service as any).fetchWithAuth(
        'https://api.github.com/repos/test/repo',
        undefined,
        2
      )

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result.ok).toBe(true)
    })

    it('throws error after max retries', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Server Error', { status: 500 })
      )

      await expect(
        (service as any).fetchWithAuth('https://api.github.com/test', undefined, 2)
      ).rejects.toThrow('GitHub API error')
    })

    it('uses exponential backoff for retries', async () => {
      const delaySpy = vi.spyOn(service as any, 'delay')

      fetchSpy.mockResolvedValue(
        new Response('Error', { status: 500 })
      )

      try {
        await (service as any).fetchWithAuth('https://api.github.com/test', undefined, 3)
      } catch (e) {
        // Expected to throw
      }

      expect(delaySpy).toHaveBeenCalledWith(1000) // First retry: 2^0 * 1000
      expect(delaySpy).toHaveBeenCalledWith(2000) // Second retry: 2^1 * 1000
    })
  })

  describe('isTextFile', () => {
    it('identifies common text file extensions', () => {
      const testCases = [
        'README.md',
        'script.js',
        'component.tsx',
        'styles.css',
        'config.json',
        'Dockerfile',
        '.gitignore'
      ]

      testCases.forEach(filename => {
        expect((service as any).isTextFile(filename)).toBe(true)
      })
    })

    it('rejects binary file extensions', () => {
      const testCases = [
        'image.png',
        'video.mp4',
        'archive.zip',
        'binary.exe'
      ]

      testCases.forEach(filename => {
        expect((service as any).isTextFile(filename)).toBe(false)
      })
    })

    it('accepts files without extensions', () => {
      expect((service as any).isTextFile('Makefile')).toBe(true)
      expect((service as any).isTextFile('LICENSE')).toBe(true)
    })
  })

  describe('getRepoContents', () => {
    it('fetches repository contents', async () => {
      const mockContents = [
        { name: 'README.md', path: 'README.md', type: 'file' },
        { name: 'src', path: 'src', type: 'dir' }
      ]

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockContents), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const result = await (service as any).getRepoContents('owner', 'repo')

      expect(result).toEqual(mockContents)
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/contents/',
        expect.any(Object)
      )
    })

    it('includes branch parameter when not main', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      )

      await (service as any).getRepoContents('owner', 'repo', '', 'develop')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('?ref=develop'),
        expect.any(Object)
      )
    })
  })

  describe('getFileContent', () => {
    it('decodes base64 content from GitHub API', async () => {
      const content = 'Hello World'
      const base64Content = btoa(content)

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: base64Content }), { status: 200 })
      )

      const result = await (service as any).getFileContent('owner', 'repo', 'README.md')

      expect(result).toBe(content)
    })

    it('handles content with newlines', async () => {
      const content = 'Line 1\nLine 2'
      const base64Content = btoa(content).replace(/(.{60})/g, '$1\n') // Simulate GitHub's newline formatting

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: base64Content }), { status: 200 })
      )

      const result = await (service as any).getFileContent('owner', 'repo', 'file.txt')

      expect(result).toBe(content)
    })

    it('throws error when no content found', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      )

      await expect(
        (service as any).getFileContent('owner', 'repo', 'missing.txt')
      ).rejects.toThrow('No content found in file')
    })
  })

  describe('getAllFilesViaTree', () => {
    it('fetches all files recursively', async () => {
      const mockTree = {
        tree: [
          { type: 'blob', path: 'README.md', sha: 'abc123', size: 1024 },
          { type: 'blob', path: 'src/index.ts', sha: 'def456', size: 2048 },
          { type: 'tree', path: 'src', sha: 'ghi789', size: 0 },
          { type: 'blob', path: 'image.png', sha: 'jkl012', size: 5000 }
        ]
      }

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTree), { status: 200 })
      )

      const result = await (service as any).getAllFilesViaTree('owner', 'repo')

      expect(result).toHaveLength(2) // Only text files
      expect(result[0].name).toBe('README.md')
      expect(result[1].name).toBe('index.ts')
    })

    it('filters out non-text files', async () => {
      const mockTree = {
        tree: [
          { type: 'blob', path: 'doc.md', sha: 'a1', size: 100 },
          { type: 'blob', path: 'image.jpg', sha: 'a2', size: 200 },
          { type: 'blob', path: 'video.mp4', sha: 'a3', size: 300 }
        ]
      }

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(mockTree), { status: 200 })
      )

      const result = await (service as any).getAllFilesViaTree('owner', 'repo')

      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('doc.md')
    })
  })

  describe('validateConfig', () => {
    it('returns valid for accessible repos', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'test-owner',
        repo: 'test-repo'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns invalid for inaccessible repos', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      const config: GitHubRepo = {
        owner: 'invalid',
        repo: 'repo'
      }

      const result = await service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('validates with custom branch', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'owner',
        repo: 'repo',
        branch: 'develop'
      }

      await service.validateConfig(config)

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('?ref=develop'),
        expect.any(Object)
      )
    })
  })

  describe('ingestRepo', () => {
    it('processes all text files in a repository', async () => {
      const { intelligentChunkDocument } = await import('../src/lib/rag')
      const { embeddingManager } = await import('../src/lib/embedding-manager')

      // Mock tree API
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          tree: [
            { type: 'blob', path: 'README.md', sha: 'abc', size: 100 },
            { type: 'blob', path: 'src/index.ts', sha: 'def', size: 200 }
          ]
        }), { status: 200 })
      )

      // Mock file content calls
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('# README') }), { status: 200 })
      )
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('console.log("hello")') }), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo'
      }

      const documents = await service.ingestRepo(config)

      expect(documents).toHaveLength(2)
      expect(documents[0].source).toBe('github')
      expect(documents[0].sourceUrl).toContain('github.com')
      expect(intelligentChunkDocument).toHaveBeenCalledTimes(2)
      expect(embeddingManager.setMetadata).toHaveBeenCalledTimes(2)
    })

    it('filters files by path prefix', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          tree: [
            { type: 'blob', path: 'docs/guide.md', sha: 'a', size: 100 },
            { type: 'blob', path: 'src/index.ts', sha: 'b', size: 200 }
          ]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('# Guide') }), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo',
        path: 'docs'
      }

      const documents = await service.ingestRepo(config)

      expect(documents).toHaveLength(1)
      expect(documents[0].name).toContain('docs/guide.md')
    })

    it('processes documents with Azure when configured', async () => {
      const { azureServiceManager } = await import('../src/lib/azure-service-manager')
      const isConfiguredSpy = vi.spyOn(azureServiceManager, 'isConfigured').mockReturnValue(true)
      const processDocSpy = vi.spyOn(azureServiceManager, 'processDocumentWithAzure')
        .mockResolvedValue({
          id: 'azure-doc',
          name: 'test.md',
          content: 'content',
          uploadedAt: new Date().toISOString(),
          chunks: []
        })

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          tree: [{ type: 'blob', path: 'test.md', sha: 'abc', size: 100 }]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('# Test') }), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo'
      }

      await service.ingestRepo(config)

      expect(processDocSpy).toHaveBeenCalled()

      isConfiguredSpy.mockRestore()
      processDocSpy.mockRestore()
    })

    it('continues processing if a file fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          tree: [
            { type: 'blob', path: 'good.md', sha: 'abc', size: 100 },
            { type: 'blob', path: 'bad.md', sha: 'def', size: 200 }
          ]
        }), { status: 200 })
      )

      // First file succeeds
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('Good') }), { status: 200 })
      )

      // Second file fails
      fetchSpy.mockResolvedValueOnce(
        new Response('Error', { status: 500 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo'
      }

      const documents = await service.ingestRepo(config)

      expect(documents).toHaveLength(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('invalidates cache after ingestion', async () => {
      const { cacheManager } = await import('../src/lib/cache-manager')

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [] }), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo'
      }

      await service.ingestRepo(config)

      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('query-expansion')
      expect(cacheManager.invalidateByPrefix).toHaveBeenCalledWith('rag-query')
    })

    it('throws error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )

      const config: GitHubRepo = {
        owner: 'test',
        repo: 'repo'
      }

      await expect(service.ingestRepo(config)).rejects.toThrow('Failed to ingest GitHub repo')
    })

    it('includes source metadata in documents', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          tree: [{ type: 'blob', path: 'README.md', sha: 'abc', size: 100 }]
        }), { status: 200 })
      )

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: btoa('# README') }), { status: 200 })
      )

      const config: GitHubRepo = {
        owner: 'myorg',
        repo: 'myrepo',
        branch: 'develop'
      }

      const documents = await service.ingestRepo(config)

      expect(documents[0].sourceMetadata).toEqual({
        owner: 'myorg',
        repo: 'myrepo',
        branch: 'develop',
        path: 'README.md'
      })
    })
  })

  describe('delay', () => {
    it('delays execution for specified time', async () => {
      const startTime = Date.now()
      await (service as any).delay(50)
      const endTime = Date.now()

      expect(endTime - startTime).toBeGreaterThanOrEqual(45) // Allow small tolerance
    })
  })
})
