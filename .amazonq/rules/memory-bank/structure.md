# Project Structure

## Directory Organization

### `/src/components/`
React components implementing the user interface and feature modules.

**Core UI Components** (`/src/components/ui/`):
- Radix UI-based design system components (drawer, card, button, input, alert, etc.)
- Reusable, accessible UI primitives following shadcn/ui patterns

**Feature Components**:
- `QueryInterface.tsx` - Main query input and agentic response display with streaming
- `DocumentUpload.tsx` - File upload interface with drag-and-drop support
- `DocumentList.tsx` - Display and manage indexed documents
- `Integrations.tsx` - Integration hub for external data sources
- `GitHubIngestion.tsx` - GitHub repository import functionality
- `WebsiteIngestion.tsx` - Website crawling and content extraction
- `DropboxIngestion.tsx` - Dropbox file synchronization
- `OneDriveIngestion.tsx` - OneDrive integration via Microsoft Graph API
- `AzureConfiguration.tsx` - Azure service credential management and optimization settings
- `ScalingDashboard.tsx` - Embedding refresh and cache performance monitoring
- `ArchitectureDiagram.tsx` - Interactive 14-layer system architecture visualization
- `AgentWorkflowVisualizer.tsx` - Real-time agent decision-making display
- `SuggestedQuestions.tsx` - Contextual follow-up question recommendations

### `/src/lib/`
Core business logic, service integrations, and utility functions.

**Azure Services**:
- `azure-openai.ts` - Azure OpenAI client for embeddings and completions
- `azure-search.ts` - Azure AI Search integration with hybrid retrieval and semantic ranking
- `azure-service-manager.ts` - Centralized Azure service configuration and lifecycle management

**RAG System**:
- `rag.ts` - Core RAG orchestration with agentic workflows
- `embedding-manager.ts` - Document embedding generation and management
- `cache-manager.ts` - Multi-strategy caching with TTL and invalidation
- `namespace-manager.ts` - Multi-tenant isolation and namespace operations

**Agents** (`/src/lib/agents/`):
- Query classification, planning, routing, and expansion agents
- Generator-critic validation patterns
- ReAct iterative refinement logic

**Integrations** (`/src/lib/integrations/`):
- `github-service.ts` - GitHub API client for repository ingestion
- `website-service.ts` - Web scraping and content extraction
- `dropbox-service.ts` - Dropbox API integration
- `onedrive-service.ts` - Microsoft Graph API client

**Utilities**:
- `utils.ts` - Common helper functions
- `spark-fallback.ts` - Graceful degradation when Azure services unavailable

### `/src/hooks/`
Custom React hooks for state management and side effects.

- `use-spark-kv.ts` - Spark KV store integration for persistent configuration
- `use-mobile.ts` - Responsive design utilities

### `/src/types/`
TypeScript type definitions and interfaces.

- `index.ts` - Centralized type definitions for documents, configurations, agents, and Azure services

### `/src/styles/`
Global styling and theming.

- `theme.css` - Custom CSS variables and theme definitions
- `index.css` - Global styles
- `main.css` - Application-level styling

### Root Configuration Files
- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript compiler options
- `tailwind.config.js` - Tailwind CSS configuration
- `components.json` - shadcn/ui component configuration
- `theme.json` - Design system theme tokens
- `runtime.config.json` - Runtime configuration for Spark

## Architectural Patterns

### Component Architecture
- **Presentation Layer**: React functional components with hooks
- **State Management**: Local state with React hooks, persistent config via Spark KV
- **Service Layer**: Abstracted Azure service clients with error handling
- **Agent Orchestration**: Modular agent implementations with clear responsibilities

### Data Flow
1. User input → Query Interface component
2. Query Classification Agent → Complexity determination
3. Routing Agent → Strategy selection (vector/keyword/hybrid)
4. Retrieval → Azure AI Search with namespace filtering
5. Generation → Azure OpenAI with streaming
6. Validation → Generator-Critic pattern
7. Expansion → Suggested questions with caching
8. Response → UI with source citations

### Multi-Tenant Isolation
- Namespace-based partitioning in Azure AI Search
- Metadata filtering for tenant-specific queries
- Version-controlled embedding management per namespace

### Performance Optimization
- Intelligent caching at multiple layers (query, embedding, completion)
- Vector compression for storage efficiency
- Contextual compression for token reduction
- Incremental embedding refresh with change detection
