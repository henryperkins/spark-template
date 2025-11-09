# State Management & Data Flow Analysis - Spark Template

## Executive Summary

The Agentic RAG application uses a **hybrid state management architecture** combining:
1. **useKV/useStorage hook** - Primary persistent state layer (Cloudflare KV + localStorage fallback)
2. **Service singletons** - Module-level managers for LLM, caching, embeddings, telemetry
3. **Context passing** - Agent execution context threaded through query pipeline
4. **Minimal prop drilling** - Well-scoped component props without deep nesting

**Key Strengths:**
- Clean separation of concerns with service layer
- Intelligent caching with TTL, semantic hashing, version tracking
- Graceful fallbacks (localStorage, mock LLM responses)
- Budget tracking and token accounting built into orchestrator
- Structured error recovery with specific error codes

**Identified Issues:**
- Missing React Context for shared component state
- Potential over-fetching in nested component renders
- Cache invalidation timing could be improved
- Limited optimistic update handling
- No WebSocket/SSE patterns for real-time updates

---

## 1. Hook Implementation & Usage

### useKV/useStorage Hook Analysis

**File:** `/home/azureuser/spark-template/src/hooks/use-kv.ts`

**Architecture:**
```typescript
export function useKV<T = string>(key: string, initialValue?: NoInfer<T>)
  Returns: [value, setStoredValue, deleteValue] as const
```

**How It Works:**
1. **Storage Detection** - Single cached storage adapter (Cloudflare KV or localStorage)
2. **Async Load** - useEffect loads value on mount with cancellation token
3. **Sync Writes** - Setter immediately updates state, async persists to storage
4. **Error Handling** - Silent failures with console warnings, maintains state integrity

**Usage Patterns Found:**

| File | Usage | Pattern |
|------|-------|---------|
| `App.tsx:25-26` | `useStorage<Document[]>('rag-documents', [])` | Root level persistent state |
| `App.tsx:26` | `useStorage<AzureConfig>('azure-config', null)` | Configuration storage |
| No other files | - | **Not used in components** |

**Issues Identified:**

1. **Limited Usage** - Only root component uses useKV, despite many stateful sub-components
   ```typescript
   // App.tsx - only place using persistent storage
   const [documents, setDocuments] = useStorage<Document[]>('rag-documents', [])
   const [azureConfig] = useStorage<AzureConfig | null>('azure-config', null)
   ```

2. **State Duplication** - Local state in components not synced to storage
   ```typescript
   // QueryInterface.tsx - purely local state
   const [messages, setMessages] = useState<ExtendedChatMessage[]>([])  // Not persisted!
   const [query, setQuery] = useState('')
   const [loading, setLoading] = useState(false)
   ```

3. **Missing Query History Persistence** - Query history loaded async but not in component lifecycle
   ```typescript
   // QueryInterface.tsx:42-64
   useEffect(() => {
     (async () => {
       const history = await queryHistoryService.getAll()  // Service call, not useKV
     })()
   }, [])
   ```

---

## 2. Context Usage Across Application

**Finding:** **NO React Context API Usage**

Comprehensive grep search shows:
- Zero usage of `React.createContext()`
- Zero usage of `useContext()`
- Zero custom context providers

**Why This Matters:**
- Documents array is **passed as prop** through component hierarchy
- Callbacks (`onDeleteDocument`, `onEditDocument`, etc.) are **prop-drilled** through integrations
- No global error boundary context
- Loading/auth state managed separately in each component

**Prop Drilling Examples:**

1. **Integrations Tab Chain:**
   ```typescript
   // App.tsx → Integrations → GitHubIngestion/WebsiteIngestion/etc
   <Integrations onDocumentsIngested={handleDocumentsIngested} />
   
   // Integrations.tsx → wraps callback to children
   export function Integrations({ onDocumentsIngested }) {
     return (
       <GitHubIngestion onDocumentsIngested={onDocumentsIngested} />
       <WebsiteIngestion onDocumentsIngested={onDocumentsIngested} />
       <DropboxIngestion onDocumentsIngested={onDocumentsIngested} />
       <OneDriveIngestion onDocumentsIngested={onDocumentsIngested} />
     )
   }
   ```

2. **Document List Operations:**
   ```typescript
   // App.tsx → DocumentList → Edit Dialog
   <DocumentList
     documents={documents || []}
     onDeleteDocument={handleDeleteDocument}
     onEditDocument={handleEditDocumentContent}
   />
   ```

**Severity:** **Medium** - Single level of drilling acceptable, but could be eliminated with Context API

---

## 3. Data Fetching Patterns

### Overview

The application uses **NO TanStack Query** - instead implements custom patterns across multiple services.

### A. Service-Based Data Fetching

**Primary Pattern:** Module-level service singletons with internal caching

**Key Services:**

| Service | Location | Responsibility | Caching |
|---------|----------|-----------------|---------|
| `llmService` | `src/lib/services/llm-service.ts` | LLM calls with rate limiting & token tracking | In-memory (call metadata) |
| `queryHistoryService` | `src/lib/services/query-history.ts` | Query logging and retrieval history | Memory cache + KV |
| `azureServiceManager` | `src/lib/azure-service-manager.ts` | Azure OpenAI & Search integration | Document embeddings |
| `cacheManager` | `src/lib/cache-manager.ts` | TTL-based cache with invalidation | Cloudflare KV/localStorage |
| `embeddingManager` | `src/lib/embedding-manager.ts` | Embedding metadata tracking | KV storage |
| `errorTracking` | `src/lib/services/error-tracker.ts` | Error collection | In-memory buffer |

### B. LLM Service - Token-Aware Fetching

**File:** `/home/azureuser/spark-template/src/lib/services/llm-service.ts`

**Pattern:** Request → Rate Limit → Timeout → Retry → Record Metrics → Return

```typescript
export class LLMService {
  // 1. Rate limiting via token bucket
  private async acquireToken(): Promise<void> {
    // Token bucket refill at configurable QPS
  }
  
  // 2. Timeout protection
  private async withTimeout<T>(promise, timeoutMs): Promise<T> {
    // Promise.race with timeout rejection
  }
  
  // 3. Exponential backoff retry
  private async retry<T>(fn): Promise<T> {
    // Retry with jitter up to maxRetries
  }
  
  // 4. Token tracking + cost calculation
  private recordLLMOutcome(provider, model, tokens, result, ...) {
    // Records to: active context + telemetry + token tracker
  }
  
  // 5. Fallback stub generation (dev mode)
  // Returns deterministic JSON for missing /api/llm endpoint
}
```

**Issues Identified:**

1. **Metadata Recording Redundancy** - Token usage recorded in 3 places:
   ```typescript
   // Line 186-189: Context recording
   recordLLMCall(ctx, metadata)
   
   // Line 193-202: Last metadata cache
   this.lastLLMMetadata = { ... }
   
   // Line 205-216: Token tracker recording
   tokenTracker.recordUsage({ ... })
   ```

2. **No Deduplication** - Streaming completions don't prevent double-counting if interrupted

### C. Query History Service - Dual Storage Pattern

**File:** `/home/azureuser/spark-template/src/lib/services/query-history.ts`

**Pattern:** Try KV, fallback to localStorage, keep in-memory cache

```typescript
class QueryHistoryService {
  private cache: QueryHistoryEntry[] | null = null
  
  private async load(): Promise<QueryHistoryEntry[]> {
    try {
      // Try Cloudflare KV first
      const value = await this.kv.get(KV_KEY)
      if (normalized.length > 0) return normalized
    } catch {
      // Silently fall back to localStorage
    }
    
    try {
      const raw = window.localStorage.getItem(KV_KEY)
      if (raw) return this.normalize(raw)
    } catch {
      // Silently fail and return empty
    }
    
    return []
  }
  
  async add(entry: QueryHistoryEntry): Promise<void> {
    const history = await this.getAll()  // Loads from storage if needed
    history.unshift(entry)
    if (history.length > MAX_ENTRIES) history.splice(MAX_ENTRIES)
    await this.persist(history)
    this.cache = history  // Update in-memory cache
  }
}
```

**Issues:**

1. **Cache Invalidation Missing** - `invalidateCache()` method exists but not called by any component
   ```typescript
   // Line 228-230: Method exists
   invalidateCache(): void {
     this.cache = null
   }
   // But never called! Stale data persists in memory
   ```

2. **No Deduplication** - Duplicate queries added without filtering
   ```typescript
   // QueryInterface.tsx:46-56 - Manual deduplication in component
   const unique = Array.from(
     new Map(
       history
         .slice(-10)
         .reverse()
         .map(entry => [entry.query.trim(), entry.query.trim()])
     ).values()
   )
   ```

### D. Document Fetching Pattern

**File:** `/home/azureuser/spark-template/src/components/QueryInterface.tsx`

**Pattern:** Documents passed as prop, processed on demand

```typescript
export function QueryInterface({ documents }: QueryInterfaceProps) {
  const executeQuery = async (queryText: string) => {
    if (agenticMode) {
      // Route through 8 agents in sequence
      const agenticResult = await orchestrator.processQuery(
        queryText,
        documents,  // Entire documents array passed to orchestrator
        { runId, onWorkflowUpdate, onStepEvent }
      )
    } else {
      // Simple RAG: retrieval + generation
      sources = await findRelevantChunks(queryText, documents, 5, 'hybrid')
      response = await generateResponse(queryText, sources)
    }
  }
}
```

**Issues:**

1. **Full Documents Array on Every Query** - No partial loading or chunking
2. **No Query Result Caching** - Identical queries don't reuse previous results
3. **No Background Loading** - Documents loaded synchronously with App mount

---

## 4. Caching Strategies

### A. Browser Cache (localStorage)

**Handled by:** `useKV` hook fallback + individual service implementations

**Keys stored:**
- `rag-documents` - Full document collection
- `azure-config` - Azure service configuration
- `query-history` - Query history entries
- `embedding-metadata:*` - Per-document embedding metadata
- `cache:v2025.01:*` - Application cache entries

**Issues:**
1. **~5MB limit** - Will fail silently on large document collections
2. **No compression** - Stores uncompressed JSON
3. **No quota management** - App doesn't monitor localStorage usage

### B. CacheManager - TTL + Semantic Hashing

**File:** `/home/azureuser/spark-template/src/lib/cache-manager.ts` (454 lines)

**Features:**
1. **Content-Type Based TTL:**
   ```typescript
   private getTTLByContentType(keyPrefix: string): number {
     if (keyPrefix.includes('news') || keyPrefix.includes('realtime')) {
       return 5 * 60 * 1000  // 5 min
     }
     if (keyPrefix.includes('dynamic') || keyPrefix.includes('query')) {
       return 60 * 60 * 1000  // 1 hour
     }
     if (keyPrefix.includes('static') || keyPrefix.includes('document')) {
       return 24 * 60 * 60 * 1000  // 1 day
     }
   }
   ```

2. **Semantic Hash Tracking:**
   ```typescript
   async setWithSemanticHash<T>(
     key: string,
     data: T,
     semanticHash: string,
     customTTL?: number
   ): Promise<void>
   
   async checkSemanticDrift(
     key: string,
     currentHash: string,
     threshold: number = 0.9
   ): Promise<boolean>
   ```

3. **Adaptive TTL Based on Access Frequency:**
   ```typescript
   async adaptiveTTL(key: string): Promise<number> {
     const accessFrequency = entry.accessCount / hoursSinceCreation
     if (accessFrequency < 0.1) return entry.ttl * 0.5  // Less frequent → shorter TTL
     if (accessFrequency > 5) return entry.ttl * 2       // Very frequent → longer TTL
   }
   ```

4. **Metrics Collection:**
   ```typescript
   async getMetrics(): Promise<CacheMetrics> {
     return {
       totalKeys, hitRate, missRate, averageAge,
       staleEntries, byTTL, recentInvalidations
     }
   }
   ```

**Cache Usage in App:**

| Context | Invalidated By | File |
|---------|----------------|------|
| `doc:*` | Document delete/edit | `App.tsx:52-54` |
| `query-expansion:*` | Document changes | `App.tsx:53, 91-92` |
| `rag-query:*` | Document changes | `App.tsx:54, 92` |

**Issues:**

1. **Prefix Invalidation Inefficient** - Loads ALL keys to find matches:
   ```typescript
   // Line 283-294
   async invalidateByPrefix(prefix: string): Promise<number> {
     const allKeys = await this.kv.keys()  // LOADS ALL KEYS!
     const cachePrefix = this.buildCacheKey(prefix)
     const matchingKeys = allKeys.filter(key => key.startsWith(cachePrefix))
     // ...
   }
   ```

2. **No Partial Cache Invalidation** - Invalidates entire document when single chunk changes

3. **Missing: Query Cache** - `rag-query` prefix never populated, always cache misses

4. **Cleanup Race Condition** - `cleanStaleEntries()` not called anywhere:
   ```typescript
   async cleanStaleEntries(): Promise<number> {
     // Method defined but never invoked!
   }
   ```

### C. KV Storage Patterns

**File:** `/home/azureuser/spark-template/src/lib/cloudflare-kv.ts`

**Two Modes:**

1. **Worker Mode** - Uses `/api/kv` endpoint with Bearer token
2. **REST API Mode** - Direct Cloudflare API calls with credentials

**Fallback Chain:**
- Try Cloudflare KV binding
- Fall back to Cloudflare REST API
- Fall back to localStorage

**Negative Cache Pattern** - Prevents repeated 404s:
```typescript
const missingKeyExpiry = new Map<string, number>()  // Track missing keys
const MISSING_KEY_TTL_MS = 5 * 60 * 1000  // 5 minutes

// Before fetching, check if key was recently marked missing
const cachedExpiry = missingKeyExpiry.get(key)
if (cachedExpiry && cachedExpiry > Date.now()) {
  return DEFAULT_GUIDANCE[key] || null  // Skip fetch
}
```

---

## 5. Optimistic Updates & Error Recovery

### A. Optimistic Update Pattern

**File:** `/home/azureuser/spark-template/src/components/QueryInterface.tsx:65-210`

**Pattern:** Create placeholder → Execute → Replace with real response OR rollback

```typescript
const executeQuery = async (queryText: string) => {
  // Step 1: Optimistic placeholder
  const assistantPlaceholder: ExtendedChatMessage = {
    id: `msg-${Date.now()}-assistant`,
    type: 'assistant',
    content: 'Thinking...',
    isLoading: true
  }
  
  setMessages(prev => [...prev, userMessage, assistantPlaceholder])  // Immediate UI update
  setLoading(true)
  setQuery('')
  
  try {
    // Step 2: Execute query
    const agenticResult = await orchestrator.processQuery(queryText, documents, options)
    
    // Step 3: Replace placeholder with real result
    setMessages(prev =>
      prev.map(msg =>
        msg.id === assistantPlaceholder.id
          ? { ...msg, content: response, sources, agenticResult }  // Replace
          : msg
      )
    )
  } catch (err) {
    // Step 4: Rollback on error
    setMessages(prev => prev.filter(msg => msg.id !== assistantPlaceholder.id))
    // Add error message instead
    setMessages(prev => [...prev, errorMessage])
  }
}
```

**Strengths:**
- Immediate UI feedback for user
- Graceful error handling with rollback
- Preserves error hints to help diagnosis

**Weaknesses:**
- No recovery retry mechanism
- Error doesn't provide "Try Again" option for agentic queries
- Placeholder text "Thinking..." static, not animated

### B. Document Edit Error Recovery

**File:** `/home/azureuser/spark-template/src/App.tsx:59-107`

**Pattern:** Dual-track processing with state rollback

```typescript
const handleEditDocumentContent = async (documentId: string, newContent: string) => {
  const target = (documents || []).find(d => d.id === documentId)
  
  try {
    let updated: Document
    
    if (azureServiceManager.isConfigured()) {
      updated = await azureServiceManager.updateDocumentWithAzure(target, newContent, {
        preserveMetadata: true
      })
    } else {
      const { chunks } = await intelligentChunkDocument(newContent, target.id, target.name)
      updated = { ...target, chunks, processed: true, processingStatus: 'completed' }
    }
    
    // Success: update state
    setDocuments((prev = []) =>
      (prev || []).map(doc => (doc.id === documentId ? updated : doc))
    )
    
    // Invalidate related caches
    await cacheManager.invalidateDocument(documentId)
    await cacheManager.invalidateByPrefix('query-expansion')
    await cacheManager.invalidateByPrefix('rag-query')
  } catch (error) {
    // Error: mark document as errored
    setDocuments((prev = []) =>
      (prev || []).map(doc =>
        doc.id === documentId
          ? { ...doc, processingStatus: 'error', errorMessage: ... }
          : doc
      )
    )
  }
}
```

**Issues:**
1. **No Retry UI** - Users can't retry from error state
2. **Cache Invalidation in Error Path** - Happens even if update fails
3. **No Progress Tracking** - Azure update opacity

### C. Upload Error Recovery

**File:** `/home/azureuser/spark-template/src/components/DocumentUpload.tsx:103-120`

**Pattern:** Chunked upload with exponential backoff retry

```typescript
async function processLargeFile(file, docId, progressFn) {
  for (let i = 0; i < totalChunks; i++) {
    let retries = 0
    while (retries < MAX_RETRIES) {
      try {
        await uploadChunk(blob, docId, i)
        break  // Success, exit retry loop
      } catch (err) {
        retries++
        if (retries === MAX_RETRIES) {
          throw new Error(`Failed to upload chunk ${i + 1} after ${MAX_RETRIES} attempts`)
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * retries))  // Exponential backoff
      }
    }
  }
}
```

**Strengths:**
- Retry with exponential backoff (1s, 2s, 3s)
- Transparent progress tracking
- Clear error messages

**Weakness:**
- No partial retry (fails entire upload on chunk N failure)

---

## 6. WebSocket/SSE Real-Time Update Patterns

### Finding: **NO Real-Time Patterns Found**

**Search Results:**
```
grep -r "WebSocket\|EventSource\|SSE\|ws:" --include="*.ts" --include="*.tsx"
```

Files found but context differs:
- `src/lib/responses-client.ts` - Azure Responses API client (not WebSocket)
- `worker/index.ts` - Service worker setup (not WebSocket)

**Current Approach:** Polling-based via:
1. **useEffect hooks** with manual async loading (QueryInterface)
2. **Service methods** called on demand
3. **Callback chains** for state updates

**Streaming Example Found:**
```typescript
// llm-service.ts:644-684 - generateTextStream()
async *generateTextStream(prompt, options): AsyncGenerator<string, void, unknown> {
  if (!appConfig.llm.enableStreaming) {
    yield await this.generateText(prompt, options)
    return
  }
  
  const stream = azureServiceManager.generateStream(prompt, azureOptions)
  for await (const chunk of stream) {
    collected += chunk
    yield chunk  // Stream chunks to caller
  }
  
  // Record usage AFTER streaming completes (line 675)
  this.recordLLMOutcome('azure', options.model, promptTokens, collected, options, start)
}
```

**But not used in UI** - QueryInterface doesn't use streaming, waits for full response.

---

## 7. Identified Performance Issues & Anti-Patterns

### A. Over-Fetching Issues

| Issue | Location | Impact | Severity |
|-------|----------|--------|----------|
| Full document array on every query | `QueryInterface.tsx:107` | Query latency O(n documents) | **HIGH** |
| All KB keys loaded on cache invalidation | `cache-manager.ts:283-294` | Scales with cache size | **HIGH** |
| Complete query history loaded for 3 items | `QueryInterface.tsx:46` | Loads last 100 entries to get last 3 | **MEDIUM** |
| All embeddings checked on refresh | `embedding-manager.ts:113-150` | Iterates every document | **MEDIUM** |

### B. Cache Invalidation Anti-Patterns

1. **Cache Invalidation Timing** - Manual, not automatic
   ```typescript
   // App.tsx:52-54 - Must remember to invalidate after delete
   await cacheManager.invalidateDocument(documentId)
   await cacheManager.invalidateByPrefix('query-expansion')
   await cacheManager.invalidateByPrefix('rag-query')
   // What if next delete happens while this is pending?
   ```

2. **Prefix Invalidation Too Broad**
   ```typescript
   await cacheManager.invalidateByPrefix('query-expansion')  // Clears ALL query expansions!
   ```

3. **No Entry Point Invalidation**
   - Editing document doesn't invalidate previously generated responses
   - Only invalidates "query-expansion" prefix (incomplete)

### C. Stale Data Issues

1. **In-Memory Caches Not Invalidated**
   ```typescript
   // query-history-service.ts:228-230
   invalidateCache(): void {
     this.cache = null  // Method exists but never called!
   }
   ```

2. **Multiple Cached Layers**
   - CacheManager has "hits" counter, but only incremented, never exposed
   - No cache hit rate metrics in UI

3. **Document Modification Not Reflected in Chunks**
   ```typescript
   // DocumentList.tsx:43-86
   // Reconstructs content from chunks, losing original formatting
   // Edit → rechunk → might have different results
   // But old chunks still in memory
   ```

### D. Prop Drilling & Component Rerender Issues

**Current Prop Chains:**
```
App (manages documents)
  → QueryInterface (documents prop)
    → Uses documents directly
    → Re-renders on App re-render

App (manages documents)
  → DocumentList (documents prop, onDeleteDocument, onEditDocument)
    → Child modals use props
    → Re-renders on App re-render

App
  → Integrations (onDocumentsIngested callback)
    → GitHubIngestion (callback)
    → WebsiteIngestion (callback)
    → DropboxIngestion (callback)
    → OneDriveIngestion (callback)
```

**React.memo() Opportunities:**
- `QueryInterface` - Should memoize documents prop
- `DocumentList` - Should memoize handlers
- All ingestion components - Should memoize onDocumentsIngested

### E. Inefficient Renders

```typescript
// QueryInterface.tsx:46-64 - Loads history on every mount
useEffect(() => {
  let isMounted = true
  ;(async () => {
    const history = await queryHistoryService.getAll()  // Full load!
    if (!isMounted || !history || history.length === 0) return
    const unique = Array.from(
      new Map(history.slice(-10).reverse()
        .map(entry => [entry.query.trim(), entry.query.trim()])
      ).values()
    )
    setRecentQueries(unique.slice(0, 3))
  })()
  return () => { isMounted = false }
}, [])
```

**Issues:**
1. Loads last 100 items to get last 3
2. Deduplicates in component (should be service method)
3. No caching - reloads on mount, even if data unchanged

---

## 8. Error Handling & State Recovery

### Error Classification in LLMService

**File:** `/home/azureuser/spark-template/src/lib/services/llm-service.ts`

```typescript
export type LLMErrorCode = 'ETIMEDOUT' | 'ERATELIMIT' | 'EPARSE' | 'EREMOTE'

// Specific error codes with recovery strategies:
// ETIMEDOUT → User should retry
// ERATELIMIT → App should backoff (rate limiting)
// EPARSE → JSON repair agent should attempt fix
// EREMOTE → Service down, fallback to mock
```

### Error Hints in QueryInterface

**File:** `/home/azureuser/spark-template/src/components/QueryInterface.tsx:172-192`

```typescript
let hint: string | null = null
if (status === 401 || status === 403) {
  hint = 'Azure authentication failed (401/403). Check keys or RBAC token.'
} else if (status === 429) {
  hint = 'Rate limited by Azure (429). Please wait and retry.'
} else if (message.toLowerCase().includes('cors')) {
  hint = 'CORS blocked the request. Use the built-in proxy or enable CORS in Azure.'
} else if (/index(.+)?does not exist/i.test(message)) {
  hint = 'Azure Search index missing. Rebuild the index from Configuration.'
}

setLastErrorHint(hint)
// Error hint displayed to user (line 384)
```

**Issues:**
1. Hints not actionable (tell user to "retry" but no button for agentic mode)
2. No automatic retry scheduling
3. Error tracking doesn't distinguish recoverable vs. fatal

---

## 9. Summary of Key Findings

### Strengths ✓

1. **Service-Based Architecture** - LLM, cache, telemetry separated cleanly
2. **Graceful Fallbacks** - localStorage, mock responses, Azure fallback
3. **Token Accounting** - Every LLM call tracked, budgets enforced
4. **Semantic Caching** - TTL, version, hash-based invalidation
5. **Optimistic Updates** - Good UX with rollback on error
6. **Error Classification** - Specific error codes enable recovery strategies

### Weaknesses ✗

1. **NO Context API** - Prop drilling acceptable but suboptimal
2. **Inefficient Cache Invalidation** - Loads all keys for prefix match
3. **Missing Deduplication** - Query history, LLM metadata recorded multiple times
4. **Stale In-Memory Caches** - `invalidateCache()` never called
5. **Over-Fetching** - Full documents/history loaded when subset needed
6. **No Real-Time Updates** - Only polling-based, no WebSocket/SSE
7. **Incomplete Error Recovery** - Error states not retryable

### Recommendations

**High Priority:**
1. Implement React Context for documents/config (eliminate prop drilling)
2. Add cache hit/miss metrics to dashboard
3. Call `queryHistoryService.invalidateCache()` on add/clear
4. Deduplicate LLM metadata recording (remove redundancy)
5. Add "Retry" button to error states with backoff

**Medium Priority:**
1. Implement TanStack Query for query result caching
2. Optimize prefix invalidation (use KV list API pagination)
3. Add incremental document loading
4. Memoize expensive components (`React.memo`)
5. Add WebSocket streaming support for agentic queries

**Low Priority:**
1. Compress localStorage values
2. Track storage quota usage
3. Implement indexed DB for large document sets
4. Add cache metrics visualization

