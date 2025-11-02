/**
 * Cloudflare KV REST API Adapter
 *
 * Provides persistent storage using Cloudflare Workers KV via REST API.
 * Works with any hosting environment (not just Cloudflare Pages/Workers).
 *
 * Setup:
 * 1. Create a KV namespace: npx wrangler kv:namespace create "RAG_STORAGE"
 * 2. Get your Cloudflare Account ID from dashboard
 * 3. Create an API token with "Workers KV Storage:Edit" permissions
 * 4. Add to .env:
 *    VITE_CLOUDFLARE_ACCOUNT_ID=your_account_id
 *    VITE_CLOUDFLARE_KV_NAMESPACE_ID=your_namespace_id
 *    VITE_CLOUDFLARE_API_TOKEN=your_api_token
 */

const LOG_PREFIX = '[cloudflare-kv]'

export interface CloudflareKVConfig {
  accountId: string
  namespaceId: string
  apiToken: string
}

export interface CloudflareKVAdapter {
  keys: () => Promise<string[]>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

/**
 * Cloudflare KV client
 * Supports both:
 * 1. Worker API endpoint (when deployed to Cloudflare Workers)
 * 2. REST API (for local development with credentials)
 */
export class CloudflareKV implements CloudflareKVAdapter {
  private baseUrl: string
  private headers: Record<string, string>
  private useWorkerAPI: boolean

  constructor(config: CloudflareKVConfig) {
    // Check if we're running on Cloudflare Workers (has /api/kv endpoint)
    this.useWorkerAPI = window.location.hostname.includes('.workers.dev') ||
                       import.meta.env.VITE_USE_WORKER_KV === 'true'

    if (this.useWorkerAPI) {
      // Use Worker API endpoint (relative path)
      this.baseUrl = '/api/kv'
      this.headers = {
        'Content-Type': 'application/json',
      }
      console.info(`${LOG_PREFIX} Using Worker KV API`)
    } else {
      // Use Cloudflare REST API
      this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/storage/kv/namespaces/${config.namespaceId}`
      this.headers = {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      }
      console.info(`${LOG_PREFIX} Using Cloudflare REST API`)
    }
  }

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText)
      throw new Error(
        `${LOG_PREFIX} API error (${response.status}): ${error}`
      )
    }

    return response
  }

  async keys(): Promise<string[]> {
    try {
      const path = this.useWorkerAPI ? '' : '/keys'
      const response = await this.request(path)

      if (this.useWorkerAPI) {
        // Worker API returns array directly
        return await response.json() as string[]
      } else {
        // REST API returns object with result
        const data = await response.json() as {
          result: Array<{ name: string }>
          success: boolean
        }

        if (!data.success) {
          throw new Error('API returned success: false')
        }

        return data.result.map(item => item.name)
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to list keys:`, error)
      throw error
    }
  }

  async get(key: string): Promise<unknown> {
    try {
      const encodedKey = encodeURIComponent(key)
      const path = this.useWorkerAPI ? `/${encodedKey}` : `/values/${encodedKey}`
      const response = await this.request(path)

      if (this.useWorkerAPI) {
        // Worker API returns JSON directly
        return await response.json()
      } else {
        // REST API returns raw value
        const text = await response.text()

        if (!text || text.length === 0) {
          return undefined
        }

        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
    } catch (error: any) {
      if (error.message?.includes('404')) {
        return undefined
      }
      console.error(`${LOG_PREFIX} Failed to get key "${key}":`, error)
      throw error
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      const encodedKey = encodeURIComponent(key)
      const body = typeof value === 'string' ? value : JSON.stringify(value)
      const path = this.useWorkerAPI ? `/${encodedKey}` : `/values/${encodedKey}`
      const method = this.useWorkerAPI ? 'POST' : 'PUT'

      await this.request(path, {
        method,
        body,
      })

      console.debug(`${LOG_PREFIX} Set key "${key}" (${body.length} bytes)`)
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to set key "${key}":`, error)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const encodedKey = encodeURIComponent(key)
      const path = this.useWorkerAPI ? `/${encodedKey}` : `/values/${encodedKey}`

      await this.request(path, {
        method: 'DELETE',
      })

      console.debug(`${LOG_PREFIX} Deleted key "${key}"`)
    } catch (error: any) {
      // Ignore 404 errors on delete
      if (!error.message?.includes('404')) {
        console.error(`${LOG_PREFIX} Failed to delete key "${key}":`, error)
        throw error
      }
    }
  }
}

/**
 * Check if Cloudflare KV is configured via environment variables
 */
export function isCloudflareKVConfigured(): boolean {
  return !!(
    import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID &&
    import.meta.env.VITE_CLOUDFLARE_KV_NAMESPACE_ID &&
    import.meta.env.VITE_CLOUDFLARE_API_TOKEN
  )
}

/**
 * Create a Cloudflare KV instance from environment variables
 */
export function createCloudflareKV(): CloudflareKV | null {
  if (!isCloudflareKVConfigured()) {
    console.warn(
      `${LOG_PREFIX} Not configured. Set VITE_CLOUDFLARE_ACCOUNT_ID, VITE_CLOUDFLARE_KV_NAMESPACE_ID, and VITE_CLOUDFLARE_API_TOKEN`
    )
    return null
  }

  const config: CloudflareKVConfig = {
    accountId: import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID!,
    namespaceId: import.meta.env.VITE_CLOUDFLARE_KV_NAMESPACE_ID!,
    apiToken: import.meta.env.VITE_CLOUDFLARE_API_TOKEN!,
  }

  console.info(`${LOG_PREFIX} Initialized with namespace ${config.namespaceId}`)
  return new CloudflareKV(config)
}

/**
 * Test Cloudflare KV connection
 */
export async function testCloudflareKV(): Promise<boolean> {
  const kv = createCloudflareKV()
  if (!kv) {
    return false
  }

  try {
    // Try to list keys as a connection test
    await kv.keys()
    console.info(`${LOG_PREFIX} Connection test successful`)
    return true
  } catch (error) {
    console.error(`${LOG_PREFIX} Connection test failed:`, error)
    return false
  }
}
