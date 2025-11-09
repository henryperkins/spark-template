import { createCloudflareKV } from '@/lib/cloudflare-kv'

export class SecureTokenStorage {
  private static readonly TOKEN_PREFIX = 'secure:token:'
  private kv = createCloudflareKV()

  async setToken(service: string, token: string): Promise<void> {
    if (!this.kv) {
      throw new Error('KV storage not available')
    }
    const encrypted = await this.encrypt(token)
    await this.kv.set(`${SecureTokenStorage.TOKEN_PREFIX}${service}`, encrypted)
  }

  async getToken(service: string): Promise<string | null> {
    if (!this.kv) {
      console.warn('KV storage not available')
      return null
    }
    const encrypted = await this.kv.get(`${SecureTokenStorage.TOKEN_PREFIX}${service}`)
    if (!encrypted || typeof encrypted !== 'string') {
      return null
    }
    return await this.decrypt(encrypted)
  }

  private async encrypt(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const key = await this.getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)
    let binary = ''
    for (let i = 0; i < combined.byteLength; i++) {
      binary += String.fromCharCode(combined[i])
    }
    return btoa(binary)
  }

  private async decrypt(encrypted: string): Promise<string> {
    const bytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
    const iv = bytes.slice(0, 12)
    const encryptedData = bytes.slice(12)
    const key = await this.getEncryptionKey()
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData)
    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  }

  private async getEncryptionKey(): Promise<CryptoKey> {
    const rawKeyString = import.meta.env.VITE_ENCRYPTION_KEY

    if (!rawKeyString) {
      throw new Error(
        'SecureTokenStorage requires VITE_ENCRYPTION_KEY to be set in environment variables. ' +
        'Refusing to encrypt with insecure fallback. Generate a secure key: ' +
        'openssl rand -base64 32'
      )
    }

    if (rawKeyString.length < 32) {
      throw new Error(
        'VITE_ENCRYPTION_KEY must be at least 32 characters for adequate security. ' +
        'Generate a secure key: openssl rand -base64 32'
      )
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rawKeyString),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    )
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new Uint8Array(16), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }
}

export const secureTokenStorage = new SecureTokenStorage()