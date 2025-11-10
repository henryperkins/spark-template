# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Agentic RAG (Retrieval-Augmented Generation)** application built with React, TypeScript, and Vite. Originally designed for GitHub Spark, it now primarily targets **Cloudflare Workers** for production deployment. The application provides an intelligent knowledge assistant that can ingest documents from multiple sources, process them using AI agents powered by Azure OpenAI, and answer queries using advanced retrieval strategies.

## Development Commands

### Running the Application
- `npm run dev` - Start development server (Vite)
- `npm run preview` - Preview production build locally

### Building and Quality
- `npm run build` - Build for production (runs full TypeScript type checking via `tsc --noEmit` then Vite build)
- `npm run lint` - Run ESLint to check code quality
- `npm run test` - Run test suite (Vitest)
- `npm run optimize` - Optimize Vite dependencies

### Cloudflare Deployment
- `npm run cf:dev` - Start local development server for Cloudflare Worker
- `npm run cf:deploy` - Deploy worker to Cloudflare
- `npm run cf:deploy:staging` - Deploy worker to staging environment
- `npm run cf:deploy:production` - Deploy worker to production environment

### Utilities
- `npm run kill` - Kill process on port 5000

## Architecture Overview

### Core Technology Stack
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 6 with SWC for fast compilation
- **Runtime**: Cloudflare Workers (production) / Vite dev server (development)
- **Styling**: Tailwind CSS 4 with custom theming
- **Storage**: Cloudflare KV (production) with localStorage fallback
- **LLM Provider**: Azure OpenAI (primary) with mock fallbacks
- **UI Components**: Radix UI primitives with custom styling
- **Icons**: Phosphor Icons

### Platform Integration & Storage

The app uses a **hybrid runtime** with automatic detection:

**Storage (Priority Order)**:
1. **Cloudflare KV** (Worker binding or REST API) - Production storage
2. **localStorage** - Development fallback

**LLM (Priority Order)**:
1. **Azure OpenAI** - Primary production LLM provider
2. **Mock responses** - Development fallback when Azure not configured

**Runtime Detection**:
Two `runtime` modules provide different capabilities:
- **src/lib/config.ts** exports `runtime` with environment detection helpers:
  - `isCloudflareWorkers()` - Detects Cloudflare Workers deployment
  - `isCloudflareKVConfigured()` - Checks KV configuration
  - `isAzureConfigured()` - Checks Azure OpenAI configuration
  - `getStorageMode()` - Returns 'cloudflare' or 'local'
- **src/lib/runtime-context.ts** exports `runtime` with service providers:
  - `llm` - LLM provider instance
  - `kv` - KV storage adapter
  - `telemetry` - Telemetry sink

Note: Icons are imported directly from '@phosphor-icons/react'; no additional Vite plugins are required. The current vite.config.ts uses @vitejs/plugin-react-swc, @tailwindcss/vite, vite-plugin-wasm, and vite-plugin-top-level-await.

### State Management Pattern

The `useKV` hook (src/hooks/use-kv.ts) is the primary persistent state mechanism:
- Automatically syncs state to Cloudflare KV or localStorage fallback
- Auto-detects runtime environment and selects appropriate storage
- Returns `[value, setter, deleter]` tuple similar to useState
- Use for all persistent application state (documents, config, etc.)
- Also exported as `useStorage` (alias for `useKV`)

Example:
```typescript
const [documents, setDocuments] = useKV<Document[]>('rag-documents', [])
// OR
const [documents, setDocuments] = useStorage<Document[]>('rag-documents', [])
```

**See**: `docs/CLOUDFLARE.md` for detailed architecture information.

### Multi-Agent RAG System

The application uses a sophisticated agent orchestration system (src/lib/agents/):

1. **AgenticOrchestrator** (orchestrator.ts) - Main coordinator that manages the entire query workflow
2. **QueryClassifierAgent** (query-classifier.ts) - Classifies query complexity and determines if decomposition is needed
3. **QueryPlannerAgent** (query-planner.ts) - Creates multi-step plans for complex queries
4. **RoutingAgent** (routing-agent.ts) - Selects retrieval strategy (semantic, keyword, hybrid)
5. **QueryExpansionAgent** (query-expansion.ts) - Expands queries with synonyms, related terms, etc.
6. **CriticAgent** (critic-agent.ts) - Validates response quality and identifies gaps
7. **ReActAgent** (react-agent.ts) - Refines responses using reasoning and acting cycles
8. **DocumentAnalyzerAgent** (document-analyzer.ts) - Determines optimal chunking strategy for documents

### Document Processing Pipeline

Documents flow through this pipeline:
1. Upload/ingestion from sources (upload, GitHub, website, Dropbox, OneDrive)
2. **Intelligent chunking** via DocumentAnalyzerAgent (supports: paragraph, sentence, semantic, fixed strategies)
3. **Embedding generation** locally or via Azure OpenAI
4. **Storage** in Cloudflare KV and optionally Azure AI Search index
5. **Retrieval** during queries using various strategies

### Azure Integration

Optional Azure services integration (src/lib/azure-service-manager.ts):
- **Azure OpenAI**: For embeddings and completions
- **Azure AI Search**: For vector search with semantic ranking, hybrid search, and reranking
- Configuration stored in Cloudflare KV under 'azure-config' key
- Documents can be indexed to Azure AI Search for enterprise-grade retrieval

### Cache Management

The CacheManager (src/lib/cache-manager.ts) provides:
- TTL-based caching with different expiration for different content types
- Semantic hash-based invalidation
- Prefix-based bulk invalidation
- Cache metrics and monitoring

### Component Structure

**Main App** (src/App.tsx): Tab-based interface with 7 sections:
- Query: Chat interface for asking questions
- Upload: Single document upload
- Integrations: GitHub, website, Dropbox, OneDrive ingestion
- Knowledge: Document list and management
- Scaling: Performance metrics and dashboards
- Azure: Azure service configuration
- Architecture: System architecture visualization

**UI Components** (src/components/ui/): Radix UI-based components using Tailwind variants
**Feature Components** (src/components/): Business logic components (DocumentUpload, QueryInterface, etc.)

### Path Aliases

TypeScript and Vite are configured with `@/*` alias pointing to `src/*`:
```typescript
import { Document } from '@/types'
import { useKV } from '@/hooks/use-kv'
```

### Type Definitions

Core types in src/types/index.ts include:
- `Document`: Represents uploaded/ingested documents with chunks
- `DocumentChunk`: Text chunks with embeddings
- `QueryResponse`: Query results with sources and metadata
- `Source`: Retrieved chunks with relevance scores
- `AzureConfig`: Azure service configuration
- `IntegrationSource`: External data source configurations

## Important Development Notes

### Working with Cloudflare KV
- Always use `useKV` (or `useStorage`) hook for persistent state, not localStorage directly
- KV keys are namespaced (e.g., 'rag-documents', 'azure-config')

### LLM Service Integration
- **Always** route LLM calls through `llmService` (src/lib/services/llm-service.ts)
- Do NOT call `azureServiceManager` directly from UI or controller code
- `llmService` provides token tracking, rate limiting, retry logic, and telemetry
- Example: `llmService.generateText(prompt, options)` or `llmService.generateJson(prompt, schema, options)`

### Agent Development
- All agents follow similar patterns: analyze input, make decisions, return structured results
- Agents are stateless and composable
- The orchestrator manages the workflow and tracks execution steps
- Add new agents to src/lib/agents/ and register in orchestrator

### Azure Service Integration
- Check `azureServiceManager.isConfigured()` before using Azure features
- All Azure operations should have fallbacks to local processing
- Connection testing happens on initialization

### Styling
- Use Tailwind utility classes with Spark's custom theme variables
- Theme extends standard Tailwind with neutral/accent color scales (1-12)
- Custom spacing and border radius use CSS variables from Spark
- Dark mode uses `[data-appearance="dark"]` selector

### ESLint Configuration
- ESLint 9 with TypeScript ESLint parser configured in package.json
- Includes React hooks and React refresh plugins
- Run `npm run lint` to check for issues

## Testing and Debugging

- Use browser DevTools console to check Spark fallback warnings
- Cache metrics available via `cacheManager.getMetrics()`
- Agent workflow steps are tracked and returned with query results for debugging

## Related Documentation

See these files for deeper architectural information:
- `docs/ARCHITECTURE.md` - Detailed agent system design and patterns
- `docs/AZURE_OPTIMIZATION.md` - Azure AI Search integration and optimization
- `docs/LAYER_UPGRADES.md` - Production upgrade patterns (Layers 6-8)
- `PRD.md` - Product requirements and feature specifications
