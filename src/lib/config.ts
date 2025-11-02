// Centralized typed configuration for context, prompts, retrieval, safety, and telemetry
// Values are sourced from Vite env (import.meta.env.VITE_*) with process.env fallback and sensible defaults.

export interface AppConfig {
  model: {
    defaultModel: string
  }
  llm: {
    maxRetries: number
    retryBackoffMs: number
    timeoutMs: number
    rateLimitQPS: number
    rateLimitBurst: number
    enableStreaming: boolean
  }
  truncation: {
    tokenCharRatio: number
    criticMaxTokens: number
    reactThoughtMaxTokens: number
    reactRefineMaxTokens: number
    expansionMaxTokens: number
    plannerMaxTokens: number
    classifierMaxTokens: number
    routerMaxTokens: number
  }
  retrieval: {
    maxResults: number
    perDocLimit: number
    dedupeByDocument: boolean
    minRelevance: number
  }
  prompts: {
    enforceJsonOnly: boolean
  }
  safety: {
    sanitizeQueries: boolean
    maxUserQueryChars: number
    redactPII: boolean
  }
  temps: {
    classifier: number
    planner: number
    router: number
    expansion: number
    critic: number
    reactThought: number
    reactRefine: number
  }
  telemetry: {
    enableAgentMetrics: boolean
  }
  critic: {
    maxSources: number
  }
}

function readEnv(key: string): string | undefined {
  try {
    const val = (import.meta as any)?.env?.[key]
    if (val !== undefined) return String(val)
  } catch {
    // ignore
  }
  try {
    const val = (globalThis as any)?.process?.env?.[key]
    if (val !== undefined) return String(val)
  } catch {
    // ignore
  }
  return undefined
}

function envInt(key: string, def: number): number {
  const v = readEnv(key)
  if (v === undefined) return def
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : def
}

function envFloat(key: string, def: number): number {
  const v = readEnv(key)
  if (v === undefined) return def
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : def
}

function envBool(key: string, def: boolean): boolean {
  const v = readEnv(key)
  if (v === undefined) return def
  const s = String(v).toLowerCase().trim()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return def
}

function envStr(key: string, def: string): string {
  const v = readEnv(key)
  return v !== undefined ? String(v) : def
}

let cached: AppConfig | null = null

export function getAppConfig(): AppConfig {
  if (cached) return cached

  const config: AppConfig = {
    model: {
      defaultModel: envStr('VITE_DEFAULT_MODEL', 'gpt-4o-mini')
    },
    llm: {
      maxRetries: envInt('VITE_LLM_MAX_RETRIES', 3),
      retryBackoffMs: envInt('VITE_LLM_RETRY_BACKOFF_MS', 300),
      timeoutMs: envInt('VITE_LLM_TIMEOUT_MS', 20000),
      rateLimitQPS: envInt('VITE_LLM_RATE_LIMIT_QPS', 5),
      rateLimitBurst: envInt('VITE_LLM_RATE_LIMIT_BURST', 10),
      enableStreaming: envBool('VITE_LLM_ENABLE_STREAMING', false)
    },
    truncation: {
      tokenCharRatio: envFloat('VITE_TOKEN_CHAR_RATIO', 4.0),
      criticMaxTokens: envInt('VITE_CRITIC_MAX_TOKENS', 900),
      reactThoughtMaxTokens: envInt('VITE_REACT_THOUGHT_MAX_TOKENS', 150),
      reactRefineMaxTokens: envInt('VITE_REACT_REFINE_MAX_TOKENS', 800),
      expansionMaxTokens: envInt('VITE_EXPANSION_MAX_TOKENS', 600),
      plannerMaxTokens: envInt('VITE_PLANNER_MAX_TOKENS', 500),
      classifierMaxTokens: envInt('VITE_CLASSIFIER_MAX_TOKENS', 300),
      routerMaxTokens: envInt('VITE_ROUTER_MAX_TOKENS', 200)
    },
    retrieval: {
      maxResults: envInt('VITE_RETRIEVAL_MAX_RESULTS', 5),
      perDocLimit: envInt('VITE_RETRIEVAL_PER_DOC_LIMIT', 2),
      dedupeByDocument: envBool('VITE_RETRIEVAL_DEDUPE_BY_DOC', true),
      minRelevance: envFloat('VITE_RETRIEVAL_MIN_RELEVANCE', 0.1)
    },
    prompts: {
      enforceJsonOnly: envBool('VITE_ENFORCE_JSON_ONLY', true)
    },
    safety: {
      sanitizeQueries: envBool('VITE_SANITIZE_QUERIES', true),
      maxUserQueryChars: envInt('VITE_MAX_USER_QUERY_CHARS', 500),
      redactPII: envBool('VITE_REDACT_PII', false)
    },
    temps: {
      classifier: envFloat('VITE_TEMP_CLASSIFIER', 0.3),
      planner: envFloat('VITE_TEMP_PLANNER', 0.4),
      router: envFloat('VITE_TEMP_ROUTER', 0.2),
      expansion: envFloat('VITE_TEMP_EXPANSION', 0.6),
      critic: envFloat('VITE_TEMP_CRITIC', 0.2),
      reactThought: envFloat('VITE_TEMP_REACT_THOUGHT', 0.3),
      reactRefine: envFloat('VITE_TEMP_REACT_REFINE', 0.4)
    },
    telemetry: {
      enableAgentMetrics: envBool('VITE_ENABLE_AGENT_METRICS', true)
    },
    critic: {
      maxSources: envInt('VITE_CRITIC_MAX_SOURCES', 5)
    }
  }

  cached = config
  return config
}

// Convenience getter (memoized)
export const appConfig = getAppConfig()

/**
 * Runtime Environment Detection
 * Determines which platform the app is running on
 */
export const runtime = {
  /**
   * Check if running on Cloudflare Workers
   * Detects .workers.dev domain or VITE_USE_WORKER_KV flag
   */
  isCloudflareWorkers(): boolean {
    if (typeof window === 'undefined') return false
    return (
      window.location.hostname.includes('.workers.dev') ||
      envBool('VITE_USE_WORKER_KV', false)
    )
  },

  /**
   * Check if Cloudflare KV is configured (REST API or Worker)
   */
  isCloudflareKVConfigured(): boolean {
    return !!(
      readEnv('VITE_CLOUDFLARE_ACCOUNT_ID') &&
      readEnv('VITE_CLOUDFLARE_KV_NAMESPACE_ID') &&
      readEnv('VITE_CLOUDFLARE_API_TOKEN')
    )
  },

  /**
   * Check if Azure OpenAI is configured
   */
  isAzureConfigured(): boolean {
    return !!(
      readEnv('VITE_AZURE_OPENAI_ENDPOINT') &&
      readEnv('VITE_AZURE_OPENAI_KEY')
    )
  },

  /**
   * Get the storage mode (cloudflare, local)
   */
  getStorageMode(): 'cloudflare' | 'local' {
    if (this.isCloudflareWorkers() || this.isCloudflareKVConfigured()) {
      return 'cloudflare'
    }
    return 'local'
  },

  /**
   * Get environment name for logging
   */
  getEnvironmentName(): string {
    const appEnv = readEnv('VITE_APP_ENV')
    if (appEnv) return appEnv

    if (this.isCloudflareWorkers()) return 'cloudflare-production'
    if (this.isCloudflareKVConfigured()) return 'development-cloudflare'
    return 'development-local'
  }
}
