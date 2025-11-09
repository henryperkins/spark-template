import { vi } from 'vitest'
import { JSDOM } from 'jsdom'

// Create a proper DOM environment for testing
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5000',
  pretendToBeVisual: true
})

global.window = dom.window as any
global.document = dom.window.document
global.navigator = dom.window.navigator

// Mock browser APIs for Node.js test environment
global.window.location = {
  hostname: 'localhost',
  href: 'http://localhost:5000',
  origin: 'http://localhost:5000',
  protocol: 'http:',
  host: 'localhost:5000',
  port: '5000',
  pathname: '/',
  search: '',
  hash: ''
} as any

Object.defineProperty(global.window, "localStorage", { value: {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
}, writable: true });

// Mock import.meta.env
if (!import.meta.env) {
  (import.meta as any).env = {}
}

// Mock fetch for CloudflareKV API calls
const originalFetch = global.fetch
global.fetch = vi.fn(async (url, options) => {
  const urlStr = typeof url === 'string' ? url : url.toString()

  // Mock CloudflareKV API endpoints
  if (urlStr.startsWith('/api/kv/')) {
    // Return mock empty response for KV operations
    return new Response(JSON.stringify(null), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }

  // For other URLs, use original fetch if available, or return mock
  if (originalFetch && typeof originalFetch === 'function') {
    return originalFetch(url, options)
  }

  // Default mock response
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}) as any
