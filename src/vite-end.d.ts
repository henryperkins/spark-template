/// <reference types="vite/client" />
declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string

declare global {
  interface Window {
    spark?: {
      llmPrompt: any
      llm: (prompt: string, model?: string, forceJson?: boolean) => Promise<string>
      kv?: {
        get: (key: string) => Promise<any>
        set: (key: string, value: any) => Promise<void>
        delete: (key: string) => Promise<void>
        keys: () => Promise<string[]>
      }
    }
  }
}

export {}