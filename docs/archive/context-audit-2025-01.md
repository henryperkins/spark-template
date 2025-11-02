# 3. Comprehensive Context Audit Report

## Executive Summary

After exhaustively scanning **92 TypeScript files**, I've identified **EVERY location** where context flows, is stored, tracked, or could be leveraged. Here's what exists and what's missing.

---

## 1. AGENT CONTEXT FLOW

### Current Agent Context Passing: MINIMAL ❌

| Agent | Input Parameters | Context Received | Context Missing |
|-------|------------------|------------------|-----------------|
| **QueryClassifierAgent** | `query: string` | ❌ None | ✅ Documents, KB characteristics |
| **QueryPlannerAgent** | `query: string`, `estimatedSubQueries: number` | ❌ None | ✅ Classification, KB topics |
| **RoutingAgent** | `query: string` | ❌ None | ✅ KB vocabulary, document types, classification |
| **CriticAgent** | `query: string`, `response: string`, `sources: Source[]` | ✅ Sources only | ✅ Classification, routing strategy |
| **ReActAgent** | `query: string`, `response: string`, `sources: Source[]`, `issues: string[]` | ✅ Issues only | ✅ Classification, validation full result |
| **QueryExpansionAgent** | `query: string`, `documents: Document[]`, `sources?: Source[]` | ✅ Documents, sources | ✅ Classification, validation, routing |
| **DocumentAnalyzerAgent** | `fileName: string`, `contentSample: string` | ❌ None | ✅ Full document length, target use case |

**KEY FINDING:** Agents operate in **near-complete isolation** with no shared context object.

---

## 2. ORCHESTRATOR CONTEXT MANAGEMENT

### File: `src/lib/agents/orchestrator.ts`

**What Context IS Tracked:**

```typescript
interface ProcessQueryOptions {
  runId?: string
  onWorkflowUpdate?: (workflow: AgentWorkflowStep[]) => void
  onStepEvent?: (event: AgentStepEvent) => void
}

interface AgentWorkflowStep {
  agent: string
  action: string
  result: unknown  // ⚠️ Untyped!
  timestamp: string
  duration?: number
  status: 'pending' | 'running' | 'completed' | 'failed'
}
```

**What Context IS Returned:**

```typescript
interface AgenticRAGResult {
  response: string
  sources: Source[]
  classification: QueryClassification
  routing?: RoutingDecision
  plan?: QueryPlan
  validation?: ValidationResult
  refinement?: ReActResult
  expansion?: QueryExpansion
  workflow: AgentWorkflowStep[]
  totalDuration: number
}
```

**Critical Gaps:**
- ❌ No knowledge base context pre-computed
- ❌ No session/user context
- ❌ No query history
- ❌ No agent-to-agent context passing
- ❌ No intermediate retrieval metadata
- ❌ No token usage tracking
- ❌ No cost tracking

---

## 3. UI COMPONENT CONTEXT

### QueryInterface.tsx (Lines 24-297)

**State Management:**
```typescript
const [messages, setMessages] = useState<ExtendedChatMessage[]>([])
const [orchestrator] = useState(() => new AgenticOrchestrator())
const [activeWorkflow, setActiveWorkflow] = useState<AgentWorkflowStep[]>([])

interface ExtendedChatMessage extends ChatMessage {
  agenticResult?: AgenticRAGResult  // ✅ Stores full result
}
```

**Context Flow:**
1. User submits query → creates `userMessage`
2. Calls `orchestrator.processQuery(query, documents, { runId, onWorkflowUpdate })`
3. Receives `AgenticRAGResult`
4. Stores in message with `agenticResult` field
5. Displays via `AgentWorkflowVisualizer`

**What's Tracked:**
- ✅ Per-query workflow steps
- ✅ Agent results (classification, routing, validation, etc.)
- ✅ Sources and response
- ✅ Duration and metrics

**What's Missing:**
- ❌ No session-level query history
- ❌ No cross-query learning
- ❌ No user preference tracking
- ❌ No context between queries in same session

---

## 4. CACHE CONTEXT

### File: `src/lib/cache-manager.ts`

**Cache Entry Structure:**
```typescript
interface CacheEntry<T> {
  data: T
  timestamp: string
  version: string
  ttl: number
  accessCount: number
  lastAccessed: string
  semanticHash?: string  // ✅ For drift detection
}
```

**What's Cached:**
```typescript
// RAG queries (line 255 in rag.ts)
const cacheKey = `rag-query:${strategy}:${maxResults}:${hashString(normalizedQuery)}:${hashString(documentFingerprint)}`

// Query expansion (line 44 in query-expansion.ts)
const cacheKey = `query-expansion:${query}:${docIds}:${sourceIds}`

// Document analysis (line 28 in document-analyzer.ts)
const cacheKey = `doc-analysis:${fileName}`
```

**Cache Context Metadata:**
- ✅ Access patterns (count, last accessed)
- ✅ TTL by content type
- ✅ Semantic drift detection
- ✅ Invalidation history

**What's NOT Cached:**
- ❌ Classification results
- ❌ Routing decisions
- ❌ Validation results
- ❌ Knowledge base characteristics

---

## 5. TELEMETRY & ANALYTICS CONTEXT

### Files: `src/lib/services/telemetry.ts`, `src/lib/services/agent-analytics.ts`

**Telemetry Events:**
```typescript
interface AgentStepEvent {
  type: 'agent_step_status'
  runId: string       // ✅ Query tracking ID
  query: string       // ✅ Full query text
  agent: string
  action: string
  status: AgentStepStatus
  stepIndex: number
  duration?: number
  failureReason?: string
  timestamp: string
}

interface AgentAlertEvent {
  type: 'agent_step_alert'
  runId: string
  severity: 'warning' | 'error'
  code: 'long_running_step' | 'step_failure'
  // ... similar fields
}
```

**What's Tracked:**
- ✅ Per-step execution (agent, action, duration, status)
- ✅ Run ID for query correlation
- ✅ Failure tracking (consecutive failures)
- ✅ Performance alerts (long-running >15s)

**What's Sent to Backend:**
```typescript
// analytics-backend.ts
interface SendPayload {
  event: string
  data: unknown  // ⚠️ Untyped agent data
  timestamp: string
}
```

**What's NOT Tracked:**
- ❌ No query classification metadata
- ❌ No routing strategy per query
- ❌ No validation scores
- ❌ No token/cost metrics
- ❌ No user session correlation
- ❌ No KB context snapshot

---

## 6. RAG CONTEXT

### File: `src/lib/rag.ts`

**Retrieval Context:**
```typescript
// Line 242-280
async function findRelevantChunks(
  query: string,
  documents: Document[],
  maxResults: number = 5,
  strategy: 'vector' | 'keyword' | 'hybrid' = 'hybrid'
): Promise<Source[]>
```

**Current Context Used:**
- ✅ Strategy selection (vector/keyword/hybrid)
- ✅ Document fingerprint for caching
- ✅ Azure vs local fallback

**Missing Context:**
- ❌ No query complexity awareness
- ❌ No user preferences
- ❌ No retrieval metadata returned (e.g., search quality)
- ❌ No alternative results or reranking metadata

**Generation Context:**
```typescript
// Line 309-343
async function generateResponse(query: string, sources: Source[]): Promise<string>
```

**Context Used:**
- ✅ Sources with content
- ✅ Azure vs Spark LLM routing

**Missing:**
- ❌ No query classification
- ❌ No response style preferences
- ❌ No citation requirements
- ❌ No token budget limits

---

## 7. AZURE SERVICE CONTEXT

### File: `src/lib/azure-service-manager.ts`

**Context Available:**
```typescript
class AzureServiceManager {
  private config: AzureConfig | null = null

  async searchWithAzure(
    query: string,
    strategy: 'vector' | 'keyword' | 'hybrid'
  ): Promise<Source[]>
}
```

**Azure Config Context:**
```typescript
interface AzureConfig {
  openai: {
    endpoint, apiKey, deploymentName, embeddingDeploymentName,
    enableStreaming, enableStoredCompletions
  }
  search: {
    endpoint, apiKey, indexName, namespace,
    semanticConfiguration: { enabled, configName, prioritizeTitle, prioritizeKeywords }
    vectorCompression: { enabled, method }
    customScoring: { enabled, recencyWeight, lengthWeight, metadataWeight }
    hybridSearch: { enabled, maxTextRecallSize, enableRRF, enableSemanticReranker }
    contextCompression: { enabled, method, compressionRatio }
  }
}
```

**What's Configured:**
- ✅ Semantic ranking options
- ✅ Hybrid search parameters
- ✅ Custom scoring weights
- ✅ Context compression

**What's NOT Used:**
- ❌ Query complexity doesn't affect search config
- ❌ User preferences don't tune scoring
- ❌ No adaptive parameter tuning based on results

---

## 8. DOCUMENT METADATA CONTEXT

### File: `src/types/index.ts`

**Document Context:**
```typescript
interface Document {
  id: string
  name: string
  size: number
  uploadedAt: string
  type: string
  chunks: DocumentChunk[]
  processed: boolean
  azureIndexed?: boolean
  processingStatus?: 'pending' | 'processing' | 'completed' | 'error'
  errorMessage?: string
  source?: 'upload' | 'github' | 'website' | 'dropbox' | 'onedrive'
  sourceUrl?: string
  sourceMetadata?: Record<string, any>  // ✅ Flexible metadata
}

interface DocumentChunk {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  embedding?: number[]
  azureEmbedding?: number[]
  vectorId?: string
  namespace?: string
  metadata?: ChunkMetadata
}

interface ChunkMetadata {
  tenant?: string
  doc_type?: string
  source?: string
  pii_flag?: boolean
  timestamp?: string
  namespace_id?: string
}
```

**What's Tracked:**
- ✅ Document source and URL
- ✅ Processing status
- ✅ Chunk-level metadata (tenant, PII, etc.)
- ✅ Namespace support

**What's NOT Tracked:**
- ❌ Document domain/topic classification
- ❌ Document complexity score
- ❌ Vocabulary style (technical/colloquial)
- ❌ Usage statistics (query hits)
- ❌ Quality metrics (completeness, clarity)

---

## 9. EMBEDDING & NAMESPACE CONTEXT

### File: `src/lib/embedding-manager.ts`

**Embedding Metadata:**
```typescript
interface EmbeddingMetadata {
  version: string
  lastRefreshed: string
  checksum: string        // ✅ For change detection
  modelVersion: string
  chunkCount: number
  documentId: string
  documentName: string
  volatility: 'high' | 'medium' | 'low'  // ✅ Update frequency
}
```

**Namespace Context (src/lib/namespace-manager.ts):**
```typescript
interface NamespaceConfig {
  id: string
  tenant: string
  environment: 'production' | 'staging' | 'development'
  domain?: string
  created: string
  documentCount: number
  compressionEnabled: boolean
  metadata?: Record<string, any>
}
```

**What's Managed:**
- ✅ Multi-tenant isolation
- ✅ Environment separation
- ✅ Embedding versioning and refresh strategy

**What's NOT Connected:**
- ❌ Namespace not passed to agents
- ❌ Tenant context not in queries
- ❌ No per-tenant optimization

---

## 10. APP-LEVEL STATE CONTEXT

### File: `src/App.tsx`

**Global State:**
```typescript
const [documents, setDocuments] = useSparkKV<Document[]>('rag-documents', [])
const [azureConfig] = useSparkKV<AzureConfig | null>('azure-config', null)
```

**What's Persisted (via Spark KV):**
- ✅ All documents
- ✅ Azure configuration
- ❌ **NO query history**
- ❌ **NO user session**
- ❌ **NO agent performance metrics**
- ❌ **NO KB context snapshot**

---

## 11. WORKFLOW VISUALIZATION CONTEXT

### File: `src/components/AgentWorkflowVisualizer.tsx`

**Displays:**
```typescript
// Per-step context (lines 206-422)
- Classification: complexity + recommendedStrategy
- Routing: strategy + confidence
- Retrieval: source count
- Planner: sub-queries with priorities
- Critic: faithfulness/relevance scores + issues
- ReAct: iterations + thought/action/observation
- Expansion: suggested questions + categories
```

**What's Visualized:**
- ✅ Complete agent execution trace
- ✅ Step-by-step results
- ✅ Duration per step
- ✅ Expandable details

**What's NOT Visualized:**
- ❌ KB context snapshot used
- ❌ Cache hits/misses
- ❌ Token usage
- ❌ Cost per step

---

## 12. SUGGESTED QUESTIONS CONTEXT

### File: `src/components/SuggestedQuestions.tsx`

**Receives:**
```typescript
interface SuggestedQuestionsProps {
  expansion: QueryExpansion
  onQuestionSelect: (question: string) => void
  loading?: boolean
}
```

**Displays:**
```typescript
- Question text
- Category (clarification/related/deeper/broader)
- Reasoning
- Relevance score
- Cache status (✅ Shows if cached)
```

**What's NOT Used:**
- ❌ Previous query in session for better suggestions
- ❌ User's question patterns
- ❌ Success rate of suggested questions

---

## CONTEXT THAT EXISTS BUT ISN'T CONNECTED

### 🔴 Critical Disconnects:

1. **Knowledge Base Characteristics** (Should be computed once, passed to all agents):
   - Document count
   - Document topics
   - Vocabulary style (technical/colloquial)
   - Content types (code/docs/guides)
   - Average document length
   - Has code blocks?
   - Technical term density

2. **Session Context** (Should persist across queries):
   - Query history in current session
   - User expertise level (inferred)
   - Preferred response style
   - Previous successful strategies

3. **Agent Performance Metrics** (Tracked in telemetry but not fed back):
   - Which routing strategies work best
   - Classification accuracy
   - Validation pass rates
   - Common failure patterns

4. **Query Metadata** (Collected but not aggregated):
   - Per-query complexity
   - Per-query strategy
   - Per-query validation scores
   - Per-query duration breakdown

---

## WHAT NEEDS TO BE ADDED

### Phase 0: Pre-Query Context (NEW)
```typescript
interface KnowledgeBaseContext {
  // Computed once, cached 1hr
  totalDocuments: number
  documentTopics: string[]
  vocabularyStyle: 'technical' | 'colloquial' | 'mixed'
  contentTypes: string[]
  hasCodeBlocks: boolean
  technicalTermDensity: number
  avgDocumentLength: number
  lastUpdated: string
}
```

### Phase 1-7: Query Execution Context (NEW)
```typescript
interface QueryExecutionContext {
  // Input
  query: string
  queryId: string
  timestamp: string

  // Static context
  knowledgeBase: KnowledgeBaseContext
  session?: SessionContext
  documents: Document[]

  // Agent results (accumulated)
  classification?: QueryClassification
  plan?: QueryPlan
  routing?: RoutingDecision
  sources: Source[]
  initialResponse?: string
  validation?: ValidationResult
  refinement?: ReActResult
  finalResponse?: string
  expansion?: QueryExpansion

  // Tracking
  errors: Array<{agent, phase, error, timestamp}>
  warnings: Array<{agent, message, timestamp}>
  phaseTimings: Map<string, number>
}
```

### Session Context (NEW)
```typescript
interface SessionContext {
  sessionId: string
  queryHistory: Array<{
    query: string
    timestamp: string
    success: boolean
    complexity?: string
  }>
  userExpertiseLevel?: 'beginner' | 'intermediate' | 'expert'
  preferredResponseStyle?: 'concise' | 'detailed' | 'technical'
}
```

---

## CRITICAL FINDINGS SUMMARY

| Context Type | Currently Exists? | Currently Connected? | Priority to Add |
|--------------|-------------------|---------------------|-----------------|
| **Knowledge Base Characteristics** | ❌ No | ❌ No | 🔴 CRITICAL |
| **Agent Cross-Context** | ❌ No | ❌ No | 🔴 CRITICAL |
| **Session/Query History** | ❌ No | ❌ No | 🟡 HIGH |
| **Document Metadata (extended)** | Partial | Partial | 🟡 HIGH |
| **Performance Metrics Feedback** | ✅ Yes (telemetry) | ❌ No | 🟡 HIGH |
| **Cache Context** | ✅ Yes | ✅ Yes | ✅ GOOD |
| **Workflow Tracking** | ✅ Yes | ✅ Yes | ✅ GOOD |
| **Namespace/Tenant** | ✅ Yes | ❌ No | 🟢 MEDIUM |
| **Token/Cost Tracking** | ❌ No | ❌ No | 🟢 MEDIUM |
| **Retrieval Metadata** | Partial | Partial | 🟢 MEDIUM |

---

## RECOMMENDATION: Implement Context Architecture

Based on this audit, you **MUST** implement the agent context architecture I proposed earlier. The application has all the pieces but they're completely disconnected.

**Next Steps:**
1. Create `agent-context.ts` with unified context types
2. Create `knowledge-base-context-manager.ts` to compute KB characteristics
3. Update orchestrator to create and pass context to all agents
4. Update each agent to accept and use context
5. Enhance prompts with context-aware information

This will transform your isolated agents into a **cohesive, context-aware intelligent system**.

---

**End of Report**
