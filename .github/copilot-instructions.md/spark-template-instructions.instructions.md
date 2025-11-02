---
applyTo: '**'
---

# Agentic RAG Knowledge Assistant

This is a production-grade Retrieval-Augmented Generation (RAG) system with multi-agent AI orchestration, built on GitHub Spark with React 19, TypeScript, and Vite.

## Architecture Overview

**Multi-Agent System**: The application orchestrates specialized AI agents for query processing (see `src/lib/agents/`):
- `orchestrator.ts` - Coordinates the entire workflow, tracks execution steps, emits telemetry
- `query-classifier.ts` - Classifies query complexity (simple/moderate/complex) and determines if decomposition is needed
- `query-planner.ts` - Breaks complex queries into sub-queries with parallel/sequential execution strategies
- `routing-agent.ts` - Selects retrieval strategy (vector/keyword/hybrid) based on query characteristics
- `critic-agent.ts` - Validates response faithfulness and relevance, identifies hallucinations
- `react-agent.ts` - Refines responses through iterative Reason-Act-Observe cycles
- `document-analyzer.ts` - Determines optimal chunking strategy (paragraph/sentence/semantic/fixed) for documents

**Agent Workflow Pattern**: Agents are stateless and composable. The orchestrator executes steps sequentially, tracks status (pending/running/completed/failed), and provides transparent workflow visibility to users.

## GitHub Spark Platform Integration

**Critical**: This app runs on GitHub Spark, which provides unique infrastructure:

1. **Spark KV Store** (`window.spark.kv`): Persistent key-value storage for all app state
   - Use `useSparkKV` hook (not useState) for persistent data: `const [docs, setDocs] = useSparkKV<Document[]>('rag-documents', [])`
   - Fallback system (`src/lib/spark-fallback.ts`) automatically uses localStorage when Spark backend unavailable
   - Never access localStorage directly - always use the Spark KV abstraction

2. **Vite Plugins** (in `vite.config.ts`):
   - `createIconImportProxy()` - Required for Phosphor icon proxying
   - `sparkPlugin()` - Required for Spark platform functionality
   - **DO NOT REMOVE** these plugins or the app will break

3. **LLM Integration**: Spark provides `window.spark.llm()` for AI completions
   - Fallback returns mock responses when backend unavailable
   - Primary path uses Azure OpenAI when configured

## State Management Pattern

All persistent state flows through Spark KV:
- Documents, chunks, embeddings: `'rag-documents'` key
- Azure config: `'azure-config'` key
- Cache entries: `'rag-query:*'` prefix pattern
- Integration sources: `'integration-sources'` key

Use the `useSparkKV(key, defaultValue)` hook which returns `[value, setter, deleter]` tuple similar to useState.

## Document Processing Pipeline

1. **Ingestion**: Upload or pull from sources (GitHub, website, Dropbox, OneDrive) - see `src/components/*Ingestion.tsx`
2. **Analysis**: DocumentAnalyzerAgent selects chunking strategy based on content structure
3. **Chunking**: `intelligentChunkDocument()` in `src/lib/rag.ts` applies strategy with overlap
4. **Embedding**: Azure OpenAI generates vectors or local fallback
5. **Indexing**: Store in Spark KV + optionally Azure AI Search
6. **Retrieval**: `findRelevantChunks()` uses hybrid search (vector + keyword) with caching

**Chunking Strategies** (selected per-document):
- `paragraph` - Split on double newlines, good for narrative content
- `sentence` - Split on sentence boundaries, good for technical docs
- `semantic` - Content-aware splitting (currently uses paragraph as baseline)
- `fixed` - Fixed-size chunks with overlap, for uniform processing

## Azure Integration (Optional)

Azure services are optional enhancers (see `src/lib/azure-service-manager.ts`):
- **Azure OpenAI**: Embeddings (text-embedding-ada-002/3-large), completions (GPT-4)
- **Azure AI Search**: Vector similarity (HNSW), hybrid search, semantic ranking, reranking

Check `azureServiceManager.isConfigured()` before using. All operations have local fallbacks.

## Key Coding Patterns

### Agent Implementation
```typescript
// All agents follow this pattern:
export class MyAgent {
  async analyze(input: string): Promise<MyResult> {
    // 1. Validate input
    // 2. Make decision/process
    // 3. Return structured result with reasoning
  }
}
```

### Workflow Execution
```typescript
// Orchestrator executeStep pattern tracks all agent actions:
const result = await this.executeStep(
  workflow,
  'AgentName',
  'Description of action',
  () => this.agent.method(args),
  emitWorkflowUpdate,
  emitStepEvent
)
```

### Cache Management
```typescript
// All retrieval operations use cache-manager.ts:
const cacheKey = `rag-query:${strategy}:${hashString(query)}:${docFingerprint}`
const cached = await cacheManager.get<Source[]>(cacheKey)
if (cached) return cached
// ... compute result ...
await cacheManager.set(cacheKey, result)
```

## Development Commands

- `npm run dev` - Start dev server (Vite on port 5000)
- `npm run build` - Production build (runs `tsc --noEmit` then `vite build`)
- `npm run lint` - ESLint check
- `npm run kill` - Kill process on port 5000

## Styling & UI

- **Framework**: Tailwind CSS 4 with Spark theme variables
- **Components**: Radix UI primitives in `src/components/ui/` (shadcn/ui pattern)
- **Theme**: Uses `[data-appearance="dark"]` for dark mode
- **Colors**: Neutral and accent scales (1-12) via CSS variables
- **Icons**: Phosphor Icons (imported via Spark proxy)

## Path Aliases

Use `@/*` for imports: `import { Document } from '@/types'`

## Critical Constraints

1. **Never remove Spark Vite plugins** - app will break
2. **Always use `useSparkKV` for state** - not useState or localStorage
3. **All agents must be stateless** - orchestrator manages workflow
4. **Provide local fallbacks for Azure** - check `isConfigured()` first
5. **Cache aggressively** - use semantic hashing for query deduplication
6. **Track telemetry** - all agent steps emit events for analytics

## Common Tasks

**Add a new agent**:
1. Create in `src/lib/agents/my-agent.ts` with typed result interface
2. Register in `orchestrator.ts` constructor
3. Add execution in `processQuery()` workflow
4. Update `AgenticRAGResult` interface with new field

**Add ingestion source**:
1. Create service in `src/lib/integrations/`
2. Create UI component in `src/components/MyIngestion.tsx`
3. Add tab in `src/App.tsx` Integrations section
4. Store config in Spark KV under `'integration-sources'`

**Modify retrieval**:
- Local search: `findRelevantChunksLocal()` in `src/lib/rag.ts`
- Azure search: `searchWithAzure()` in `src/lib/azure-service-manager.ts`
- Strategy selection: `routing-agent.ts`
