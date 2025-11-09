# State Management - Code Examples & Fixes

## Issue 1: Missing React Context (Prop Drilling)

### Current Implementation (Problematic)

**File:** `src/App.tsx` → `src/components/Integrations.tsx` → `src/components/GitHubIngestion.tsx`

```typescript
// App.tsx - Root level
function App() {
  const [documents, setDocuments] = useStorage<Document[]>('rag-documents', [])
  
  const handleDocumentsIngested = (newDocuments: Document[]) => {
    setDocuments((prev = []) => [...prev, ...newDocuments])
  }
  
  return (
    <Integrations onDocumentsIngested={handleDocumentsIngested} />
  )
}

// Integrations.tsx - Intermediate component (just passes callback)
interface IntegrationsProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function Integrations({ onDocumentsIngested }: IntegrationsProps) {
  return (
    <GitHubIngestion onDocumentsIngested={onDocumentsIngested} />
    <WebsiteIngestion onDocumentsIngested={onDocumentsIngested} />
    <DropboxIngestion onDocumentsIngested={onDocumentsIngested} />
    <OneDriveIngestion onDocumentsIngested={onDocumentsIngested} />
  )
}

// GitHubIngestion.tsx - Final consumer
interface GitHubIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function GitHubIngestion({ onDocumentsIngested }: GitHubIngestionProps) {
  const handleSync = async () => {
    const newDocs = await fetchFromGitHub()
    onDocumentsIngested(newDocs)  // Call callback
  }
}
```

### Recommended Fix: React Context

```typescript
// src/context/DocumentContext.tsx
import { createContext, useContext, ReactNode } from 'react'
import { Document } from '@/types'

interface DocumentContextType {
  documents: Document[]
  addDocuments: (docs: Document[]) => void
  deleteDocument: (id: string) => void
  editDocument: (id: string, content: string) => void
}

const DocumentContext = createContext<DocumentContextType | undefined>(undefined)

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useStorage<Document[]>('rag-documents', [])
  
  const addDocuments = (docs: Document[]) => {
    setDocuments((prev = []) => [...prev, ...docs])
  }
  
  const deleteDocument = (id: string) => {
    setDocuments((prev = []) => prev.filter(d => d.id !== id))
  }
  
  const editDocument = (id: string, content: string) => {
    // Implementation...
  }
  
  return (
    <DocumentContext.Provider value={{ documents, addDocuments, deleteDocument, editDocument }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocuments() {
  const context = useContext(DocumentContext)
  if (!context) {
    throw new Error('useDocuments must be used within DocumentProvider')
  }
  return context
}

// App.tsx - Updated
function App() {
  return (
    <DocumentProvider>
      <ResponsiveNavigation tabs={navigationTabs} />
    </DocumentProvider>
  )
}

// GitHubIngestion.tsx - Now simplified
export function GitHubIngestion() {
  const { addDocuments } = useDocuments()
  
  const handleSync = async () => {
    const newDocs = await fetchFromGitHub()
    addDocuments(newDocs)  // Direct call, no prop drilling
  }
}
```

---

## Issue 2: Cache Invalidation Loads All Keys

### Current Implementation (Inefficient)

**File:** `src/lib/cache-manager.ts:283-294`

```typescript
async invalidateByPrefix(prefix: string, reason?: string): Promise<number> {
  const allKeys = await this.kv.keys()  // LOADS ALL KEYS - O(n) KV calls!
  const cachePrefix = this.buildCacheKey(prefix)
  const matchingKeys = allKeys.filter(key => key.startsWith(cachePrefix))
  const originalKeys = matchingKeys.map(key => this.extractOriginalKey(key))
  await this.invalidate(
    originalKeys,
    'prefix',
    reason || `Prefix-based invalidation: ${prefix}`
  )
  return matchingKeys.length
}
```

### Recommended Fix: Cursor-Based Pagination

```typescript
async invalidateByPrefix(prefix: string, reason?: string): Promise<number> {
  const cachePrefix = this.buildCacheKey(prefix)
  let cursor: string | undefined = undefined
  let totalInvalidated = 0
  
  do {
    // Paginate through keys (KV API supports cursor)
    const response = await this.kv.keys(cursor)  // Implement cursor support
    const matchingKeys = response.keys.filter(key => key.startsWith(cachePrefix))
    
    if (matchingKeys.length > 0) {
      const originalKeys = matchingKeys.map(key => this.extractOriginalKey(key))
      await this.invalidate(originalKeys, 'prefix', reason)
      totalInvalidated += matchingKeys.length
    }
    
    cursor = response.cursor
  } while (cursor)
  
  return totalInvalidated
}

// Also implement direct key invalidation (preferred)
async invalidateDocument(documentId: string): Promise<void> {
  // Instead of prefix search, maintain explicit key registry
  const registry = await this.kv.get(`doc-keys:${documentId}`)
  if (registry && Array.isArray(registry)) {
    await this.invalidate(registry, 'document', `Document ${documentId} updated`)
  }
}
```

---

## Issue 3: queryHistoryService Cache Never Invalidated

### Current Implementation (Stale Cache)

**File:** `src/lib/services/query-history.ts`

```typescript
class QueryHistoryService {
  private cache: QueryHistoryEntry[] | null = null
  
  async add(entry: QueryHistoryEntry): Promise<void> {
    const history = await this.getAll()  // Loads from storage
    history.unshift(entry)
    await this.persist(history)
    this.cache = history  // Cache updated
  }
  
  invalidateCache(): void {
    this.cache = null  // METHOD EXISTS BUT NEVER CALLED!
  }
}

// Used in QueryInterface.tsx
useEffect(() => {
  ;(async () => {
    const history = await queryHistoryService.getAll()
    // Cache stays in memory even if history changes elsewhere
  })()
}, [])
```

### Recommended Fix: Auto-Invalidation

```typescript
class QueryHistoryService {
  private cache: QueryHistoryEntry[] | null = null
  private listeners: Set<() => void> = new Set()
  
  async add(entry: QueryHistoryEntry): Promise<void> {
    const history = await this.getAll()
    history.unshift(entry)
    if (history.length > MAX_ENTRIES) history.splice(MAX_ENTRIES)
    await this.persist(history)
    this.cache = history
    
    // NOTIFY ALL LISTENERS
    this.notifyListeners()
  }
  
  async clear(): Promise<void> {
    await this.persist([])
    this.cache = []
    this.notifyListeners()  // Auto-invalidate on clear
  }
  
  // Observer pattern for cache invalidation
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener())
  }
  
  onCacheChange(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
}

// Usage in component
export function QueryInterface() {
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  
  useEffect(() => {
    const unsubscribe = queryHistoryService.onCacheChange(async () => {
      const history = await queryHistoryService.getRecent(3)
      const unique = deduplicateQueries(history)
      setRecentQueries(unique)
    })
    
    // Load initial data
    ;(async () => {
      const history = await queryHistoryService.getRecent(3)
      const unique = deduplicateQueries(history)
      setRecentQueries(unique)
    })()
    
    return () => unsubscribe()
  }, [])
}
```

---

## Issue 4: LLM Metadata Recorded Redundantly

### Current Implementation (Triple Recording)

**File:** `src/lib/services/llm-service.ts:106-216`

```typescript
private recordLLMOutcome(
  provider: 'azure' | 'worker',
  model: string | undefined,
  estimatedPromptTokens: number,
  resultText: string,
  options: CompletionOptions,
  startedAt: number,
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  reasoningPreview?: string
): void {
  // ... token calculations ...
  
  // RECORDING #1: Context
  const ctx = getActiveQueryContext()
  if (ctx) {
    recordLLMCall(ctx, metadata)  // Stored in context.llmCalls[]
  }
  
  // RECORDING #2: Last call cache
  this.lastLLMMetadata = {
    model: metadata.model,
    provider: metadata.provider,
    // ...
  }
  
  // RECORDING #3: Token tracker
  try {
    tokenTracker.recordUsage({
      promptTokens,
      completionTokens,
      totalTokens,
      modelUsed: resolvedModel,
      provider,
      timestamp: new Date().toISOString()
    })
  } catch { }
}
```

### Recommended Fix: Single Source of Truth

```typescript
private recordLLMOutcome(
  provider: 'azure' | 'worker',
  model: string | undefined,
  estimatedPromptTokens: number,
  resultText: string,
  options: CompletionOptions,
  startedAt: number,
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  reasoningPreview?: string
): void {
  // Calculate once
  const metadata = this.calculateMetadata(
    provider, model, estimatedPromptTokens, resultText,
    options, startedAt, usage, reasoningPreview
  )
  
  // Record in ONE place: context (which emits telemetry)
  const ctx = getActiveQueryContext()
  if (ctx) {
    recordLLMCall(ctx, metadata)
    
    // Optional: cache last call metadata for orchestrator steps
    this.lastLLMMetadata = metadata
  } else {
    // No active context: record to token tracker directly
    tokenTracker.recordUsage({
      promptTokens: metadata.promptTokens,
      completionTokens: metadata.completionTokens,
      totalTokens: metadata.totalTokens,
      modelUsed: metadata.model,
      provider: metadata.provider,
      timestamp: new Date().toISOString()
    })
  }
}
```

---

## Issue 5: Cache Cleanup Never Runs

### Current Implementation (Dead Code)

**File:** `src/lib/cache-manager.ts:370-393`

```typescript
async cleanStaleEntries(): Promise<number> {
  // Method exists but is never called!
  const allKeys = await this.kv.keys()
  const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
  let cleaned = 0
  for (const cacheKey of cacheKeys) {
    const rawEntry = await this.kv.get(cacheKey)
    const entry = rawEntry as CacheEntry | undefined
    if (!entry) continue
    if (this.isStale(entry) || entry.version !== this.CACHE_VERSION) {
      await this.kv.delete(cacheKey)
      cleaned++
    }
  }
  return cleaned
}
```

### Recommended Fix: Scheduled Cleanup

```typescript
export class CacheManager {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000  // 1 hour
  
  constructor(kv?: CloudflareKVAdapter | null) {
    this.kv = kv || localStorageAdapter
    this.scheduleCleanup()
  }
  
  private scheduleCleanup(): void {
    // Clean stale entries periodically
    this.cleanupTimer = setInterval(async () => {
      try {
        const cleaned = await this.cleanStaleEntries()
        if (cleaned > 0) {
          console.info(`[cache-manager] Cleaned ${cleaned} stale entries`)
        }
      } catch (error) {
        console.error('[cache-manager] Cleanup failed:', error)
      }
    }, this.CLEANUP_INTERVAL_MS)
  }
  
  private async cleanStaleEntries(): Promise<number> {
    const allKeys = await this.kv.keys()
    const cacheKeys = allKeys.filter(key => key.startsWith('cache:'))
    let cleaned = 0
    
    for (const cacheKey of cacheKeys) {
      const rawEntry = await this.kv.get(cacheKey)
      const entry = rawEntry as CacheEntry | undefined
      if (!entry) continue
      
      if (this.isStale(entry) || entry.version !== this.CACHE_VERSION) {
        await this.kv.delete(cacheKey)
        cleaned++
      }
    }
    
    return cleaned
  }
  
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

// In App.tsx cleanup
useEffect(() => {
  return () => {
    cacheManager.destroy()
  }
}, [])
```

---

## Issue 6: No Query Result Caching

### Current Implementation (Cache-Less)

**File:** `src/components/QueryInterface.tsx:72-210`

```typescript
const executeQuery = async (queryText: string) => {
  // Every query is re-executed, even if identical to previous
  const agenticResult = await orchestrator.processQuery(
    queryText,
    documents,
    options
  )
  
  // Response is never cached!
}
```

### Recommended Fix: Query Result Cache

```typescript
import { useMemo, useCallback } from 'react'

// Option 1: Simple cache in component
export function QueryInterface({ documents }: QueryInterfaceProps) {
  const queryCache = useMemo(() => new Map<string, AgenticRAGResult>(), [])
  
  const executeQuery = useCallback(async (queryText: string) => {
    // Check cache first
    const cacheKey = `${queryText}:${documents.map(d => d.id).join(',')}`
    if (queryCache.has(cacheKey)) {
      const cached = queryCache.get(cacheKey)!
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-assistant`,
        type: 'assistant',
        content: cached.response,
        sources: cached.sources,
        agenticResult: cached,
        timestamp: new Date().toISOString()
      }])
      return
    }
    
    // Execute query
    const result = await orchestrator.processQuery(queryText, documents, options)
    
    // Cache result
    queryCache.set(cacheKey, result)
    
    // ... rest of code ...
  }, [documents, queryCache])
}

// Option 2: CacheManager integration (better)
const executeQuery = async (queryText: string) => {
  const cacheKey = `rag-query:${hashQuery(queryText)}:${getDocumentsFingerprint(documents)}`
  
  // Try cache first
  const cached = await cacheManager.get<AgenticRAGResult>(cacheKey)
  if (cached) {
    setMessages(prev => [...prev, createMessageFromResult(cached)])
    return
  }
  
  // Execute
  const result = await orchestrator.processQuery(queryText, documents, options)
  
  // Cache with 1-hour TTL
  await cacheManager.set(cacheKey, result, 60 * 60 * 1000)
  
  setMessages(prev => [...prev, createMessageFromResult(result)])
}

// Invalidate on document changes
const handleDocumentsIngested = (newDocuments: Document[]) => {
  setDocuments((prev = []) => [...prev, ...newDocuments])
  
  // Invalidate query cache since KB changed
  cacheManager.invalidateByPrefix('rag-query', 'Documents ingested')
}
```

---

## Summary of Recommended Changes

| Issue | Fix | Effort | Impact |
|-------|-----|--------|--------|
| No Context API | Add DocumentProvider + useDocuments hook | Medium | High - eliminates prop drilling |
| Cache invalidation inefficient | Implement cursor pagination | Medium | High - O(n) → O(log n) |
| Never invalidates history cache | Add observer pattern to service | Low | High - fixes stale data |
| Triple recording LLM metadata | Single point of recording | Low | Medium - deduplicates metrics |
| Cache cleanup never runs | Implement scheduled cleanup | Low | Medium - prevents stale bloat |
| No query result cache | Add CacheManager integration | Medium | High - prevents re-execution |

