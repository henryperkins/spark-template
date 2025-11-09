# State Management Quick Reference

## Key Files

| File | Purpose | Key Pattern |
|------|---------|-------------|
| `src/hooks/use-kv.ts` | Persistent state hook | KV adapter with localStorage fallback |
| `src/lib/cloudflare-kv.ts` | Storage adapter | Worker/REST API modes with negative cache |
| `src/lib/cache-manager.ts` | Application cache | TTL + semantic hashing + invalidation |
| `src/lib/services/llm-service.ts` | LLM integration | Rate limit + timeout + retry + metrics |
| `src/lib/services/query-history.ts` | Query logging | In-memory + KV dual storage |
| `src/App.tsx` | Root state | Documents + Azure config |
| `src/components/QueryInterface.tsx` | Query execution | Optimistic updates + error rollback |

## State Hierarchy

```
Root (App.tsx)
├── documents: Document[] (useStorage)
├── azureConfig: AzureConfig | null (useStorage)
├── QueryInterface (documents prop)
│   ├── messages: ChatMessage[] (useState - local)
│   ├── query: string (useState - local)
│   └── loading: boolean (useState - local)
├── DocumentList (documents, callbacks props)
│   └── editingDocId: string | null (useState - local)
├── Integrations (callback prop)
│   ├── GitHubIngestion
│   ├── WebsiteIngestion
│   ├── DropboxIngestion
│   └── OneDriveIngestion
└── ScalingDashboard (documents prop)
```

## Service Singletons

```typescript
// Single instance per app lifetime:
const llmService = new LLMService()
const queryHistoryService = new QueryHistoryService()
const cacheManager = new CacheManager()
const embeddingManager = new EmbeddingManager()
const azureServiceManager = new AzureServiceManager()
const tokenTracker = new TokenTracker()
const errorTracking = new ErrorTracker()
```

## Critical Issues at a Glance

| Issue | Severity | File | Line |
|-------|----------|------|------|
| No React Context (prop drilling) | MEDIUM | Multiple | - |
| Cache invalidation loads all keys | HIGH | cache-manager.ts | 283-294 |
| queryHistoryService.invalidateCache() never called | HIGH | query-history.ts | 228 |
| LLM metadata recorded in 3 places | MEDIUM | llm-service.ts | 186-216 |
| Full documents array on every query | HIGH | QueryInterface.tsx | 107 |
| No query result caching | MEDIUM | rag.ts | - |
| Streaming not used in UI | LOW | llm-service.ts | 644 |
| Error states not retryable | MEDIUM | QueryInterface.tsx | 168-202 |

## Caching Layers

1. **In-Memory (Runtime)**
   - `llmService.lastLLMMetadata`
   - `queryHistoryService.cache`
   - `cacheManager.hits/misses`

2. **Browser (localStorage)**
   - `rag-documents`
   - `azure-config`
   - `query-history`
   - `embedding-metadata:*`
   - `cache:v2025.01:*`

3. **Edge (Cloudflare KV)**
   - Same keys as localStorage
   - 30GB+ capacity
   - No quota limit

## Flow: Document Upload

```
DocumentUpload.tsx
  → intelligentChunkDocument(content, docId, name)
    → DocumentAnalyzerAgent.analyzeDocument()
      → llmService.generateJson() [AZURE or WORKER]
    → Select chunking strategy (paragraph/sentence/semantic/fixed)
    → Generate DocumentChunk[] with embeddings
  → azureServiceManager.processDocumentWithAzure() [if configured]
  → embeddingManager.setMetadata()
  → cacheManager.invalidateByPrefix('query-expansion')
  → cacheManager.invalidateByPrefix('rag-query')
  → onDocumentUploaded(document)
```

## Flow: Query Execution

```
QueryInterface.tsx
  → executeQuery(queryText)
    → [Optimistic] setMessages([user, loading-placeholder])
    
    → if (agenticMode):
        orchestrator.processQuery(queryText, documents, options)
          → ClassifierAgent (simple/moderate/complex)
          → PlannerAgent (if complex: sub-queries)
          → RoutingAgent (vector/keyword/hybrid)
          → Retrieval (findRelevantChunks)
          → GenerationAgent (response)
          → CriticAgent (validation)
          → ReActAgent (refinement if needed)
          → queryHistoryService.add()
      else:
        findRelevantChunks(queryText, documents, 5, 'hybrid')
        generateResponse(queryText, sources)
        queryHistoryService.add()
    
    → [Replace] setMessages with real response
    → on error: [Rollback] filter placeholder + show error
```

## Common Data Patterns

### Pattern: Dual-Storage Fallback
```typescript
// 1. Try primary
const value = await this.kv.get(key)
if (value) return value

// 2. Fall back to secondary
const raw = window.localStorage.getItem(key)
if (raw) return this.normalize(raw)

// 3. Return empty
return []
```

### Pattern: In-Memory Cache + Persist
```typescript
private cache: T[] | null = null

async getAll(): Promise<T[]> {
  if (this.cache) return this.cloneDeep(this.cache)
  const data = await this.load()  // From KV/localStorage
  this.cache = data
  return this.cloneDeep(data)
}

async add(entry: T): Promise<void> {
  const all = await this.getAll()
  all.unshift(entry)
  await this.persist(all)
  this.cache = all  // Update cache
}
```

### Pattern: TTL-Based Cache Invalidation
```typescript
const entry = { data, timestamp, ttl }
const age = Date.now() - new Date(timestamp).getTime()
if (age > ttl) {
  await this.kv.delete(cacheKey)
  return null
}
return entry.data
```

### Pattern: Prefix-Based Invalidation
```typescript
await cacheManager.invalidateByPrefix('doc:documentId')
await cacheManager.invalidateByPrefix('query-expansion')
await cacheManager.invalidateByPrefix('rag-query')
```

## Performance Optimization Checklist

- [ ] Add React.Context for documents (eliminate prop drilling)
- [ ] Memoize QueryInterface (React.memo)
- [ ] Memoize DocumentList (React.memo)
- [ ] Call queryHistoryService.invalidateCache() on add/clear
- [ ] Implement cacheManager.cleanStaleEntries() schedule
- [ ] Optimize prefix invalidation (use cursor pagination)
- [ ] Add query result caching (TanStack Query)
- [ ] Implement incremental document loading
- [ ] Use async generators for streaming responses
- [ ] Add "Retry" button to error states

## Testing Scenarios

1. **Cache Hit** - Run identical query twice, should use cache
2. **Cache Invalidation** - Edit document, verify query results refresh
3. **Fallback** - Disable Azure, verify localStorage/mock responses work
4. **Error Recovery** - Kill network, verify graceful degradation + hints
5. **Token Budgets** - Run expensive query, verify token tracking
6. **Stale Data** - Add document, verify it appears in searches immediately

