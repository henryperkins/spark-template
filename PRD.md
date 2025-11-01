# Azure-Enhanced Agentic RAG Knowledge Assistant

A production-ready agentic RAG system leveraging Azure OpenAI and Azure AI Search with intelligent query routing, planning, and iterative refinement capabilities for enterprise-grade knowledge retrieval.

**Experience Qualities**:
1. **Professional** - Clean, enterprise-ready interface that instills confidence in business users
2. **Intelligent** - Advanced AI agent orchestration that adapts to query complexity without exposing technical details
3. **Responsive** - Real-time feedback showing agent reasoning and decision-making process

**Complexity Level**: Complex Application (advanced agentic functionality with multi-step workflows)
The application implements production-ready agentic RAG patterns including query classification, routing agents, query planning, hybrid retrieval strategies, and generator-critic validation for hallucination reduction.

## Essential Features

### Query Classification Agent
- **Functionality**: Automatically analyze incoming queries to determine complexity and optimal handling strategy
- **Purpose**: Route queries to appropriate processing pipelines based on difficulty (simple fact retrieval vs. complex reasoning)
- **Trigger**: User submits query
- **Progression**: Query input → LLM classification (simple/moderate/complex) → Strategy selection → Pipeline routing
- **Success criteria**: 95%+ accuracy in classifying query complexity; appropriate strategy selected

### Query Planning Agent
- **Functionality**: Decompose complex queries into manageable sub-queries for specialized handling
- **Purpose**: Break down multi-faceted questions into focused retrieval tasks for better accuracy
- **Trigger**: Complex query classification
- **Progression**: Complex query → Sub-query generation → Parallel retrieval → Context aggregation → Unified response
- **Success criteria**: Complex queries answered with information from multiple document sections

### Query Expansion Agent
- **Functionality**: Analyze query context and document content to suggest related questions users might want to explore, with intelligent caching for performance
- **Purpose**: Help users discover relevant information and explore the knowledge base more effectively
- **Trigger**: After response generation (in agentic mode)
- **Progression**: Response generated → Check cache → Analyze sources and documents → Generate 4 related questions (clarification/related/deeper/broader) → Cache results → Display as interactive suggestions
- **Success criteria**: Relevant suggestions that encourage knowledge exploration; 80%+ user engagement; 90%+ cache hit rate for repeat queries

### Embedding Refresh Management
- **Functionality**: Metadata-driven incremental and full refresh strategies for document embeddings with version control
- **Purpose**: Maintain embedding accuracy while minimizing recomputation overhead through intelligent change detection
- **Trigger**: Manual refresh or scheduled intervals based on document volatility
- **Progression**: Document analysis → Checksum comparison → Refresh decision (incremental/full) → Update embeddings → Version namespace update → Metadata persistence
- **Success criteria**: <30s refresh time for changed documents; 95%+ accuracy in change detection; support for versioned rollbacks

### Cache Invalidation System
- **Functionality**: Multi-strategy cache invalidation using TTL, event-driven triggers, prefix-based clearing, and semantic drift detection
- **Purpose**: Maintain cache accuracy while maximizing hit rates through intelligent invalidation strategies
- **Trigger**: Document changes, TTL expiration, version updates, or semantic drift
- **Progression**: Change event → Strategy selection (TTL/prefix/semantic) → Cache invalidation → Metrics update → User notification
- **Success criteria**: >80% cache hit rate; <5% stale cache entries; automatic invalidation on document changes

### Scaling Dashboard
- **Functionality**: Comprehensive monitoring and management interface for embedding refresh and cache performance
- **Purpose**: Provide visibility into system health and enable manual refresh/cleanup operations
- **Trigger**: User navigates to Scaling tab
- **Progression**: Load metrics → Display stats (versions, volatility, hit rates) → Enable refresh operations → Show recent invalidations
- **Success criteria**: Real-time metrics; one-click refresh operations; clear visibility into system state

### Architecture Visualization
- **Functionality**: Interactive 14-layer architectural diagram showing the complete production multi-agent RAG system design
- **Purpose**: Provide comprehensive understanding of system architecture, component interactions, and design patterns
- **Trigger**: User navigates to Architecture tab
- **Progression**: View diagram → Explore layers → Click for details → Review components → Understand interactions → Study patterns
- **Success criteria**: All 14 layers clearly visualized; component details accessible; interaction flows documented; design patterns explained

### Routing Agent
- **Functionality**: Intelligently select between vector search, keyword search, or hybrid retrieval strategies
- **Purpose**: Match retrieval method to query characteristics for optimal results
- **Trigger**: Query received (after classification)
- **Progression**: Query analysis → Retrieval strategy selection → Execute search → Quality validation → Return results
- **Success criteria**: Measurably better retrieval accuracy vs. single-strategy approach

### ReAct Agent (Iterative Refinement)
- **Functionality**: Implement Reason-Act-Observe loops for self-improving query responses
- **Purpose**: Iteratively refine answers through thought-action-observation cycles
- **Trigger**: Initial response generated
- **Progression**: Initial answer → Self-critique → Additional context retrieval → Response refinement → Quality threshold check → Final answer
- **Success criteria**: Reduced hallucinations; higher answer quality scores

### Generator-Critic Validation
- **Functionality**: Dual-agent pattern where one generates responses and another validates factual accuracy
- **Purpose**: Significantly reduce hallucinations through intelligent verification
- **Trigger**: Response generation complete
- **Progression**: Generate response → Critic evaluates → Identify issues → Re-generate if needed → Validated output
- **Success criteria**: <5% hallucination rate; high faithfulness scores

### Intelligent Document Indexing Agent
- **Functionality**: Analyze incoming documents to determine optimal chunking, metadata extraction, and indexing strategies
- **Purpose**: Transform indexing from static to intelligent, adaptive process
- **Trigger**: Document upload
- **Progression**: Document received → Content analysis → Chunking strategy selection → Metadata generation → Embedding generation → Search index update
- **Success criteria**: Documents processed with context-appropriate strategies; searchable within 30 seconds

### Hybrid Retrieval Engine
- **Functionality**: Combine vector similarity search with keyword matching for comprehensive retrieval
- **Purpose**: Balance semantic understanding with exact term matching
- **Trigger**: Query routing agent selects hybrid mode
- **Progression**: Query → Parallel vector + keyword search → Score fusion → Reranking → Top results
- **Success criteria**: Higher relevance scores vs. single-method retrieval

### Azure OpenAI Integration
- **Functionality**: Leverage Azure OpenAI for embeddings, completions, and agent reasoning
- **Purpose**: Provide enterprise-grade AI with security and compliance
- **Trigger**: Throughout agent workflows (embeddings, classification, generation, validation)
- **Progression**: Agent request → Azure OpenAI API → Response processing → Agent decision making
- **Success criteria**: <2s average response time; 99.9% uptime

### Azure AI Search Integration  
- **Functionality**: Use Azure AI Search for vector similarity, hybrid search with RRF, semantic ranking, and quality-optimized retrieval with namespacing and contextual compression
- **Purpose**: Enable fast, scalable semantic search with enterprise features, advanced embedding quality enhancements, multitenancy isolation, and cost optimization
- **Trigger**: Retrieval agent executes search
- **Progression**: Search request → Azure AI Search API (with namespace filter, hybrid RRF, semantic ranking, custom scoring, vector compression) → Contextual compression → Result processing → Relevance scoring with reranker
- **Success criteria**: Sub-second search results; support for 10,000+ documents; improved relevance through semantic understanding; strong tenant isolation; 60%+ cost reduction via compression

### Embedding Quality Configuration
- **Functionality**: Configure Azure AI Search with semantic ranking, hybrid retrieval with RRF, vector compression, contextual compression, namespace isolation, and custom scoring profiles to optimize retrieval accuracy and cost
- **Purpose**: Maximize embedding quality and search relevance through advanced Azure AI Search features while optimizing performance, storage, and enforcing multitenancy
- **Trigger**: User configures optimization settings in Azure Configuration tab
- **Progression**: Enable hybrid search with RRF → Configure BM25 pool size and semantic ranking → Set namespace for tenant isolation → Configure contextual compression → Set vector compression method → Tune custom scoring weights (recency/length/metadata) → Save configuration → Index creation with optimizations
- **Success criteria**: RRF fusion improves relevance; semantic captions generated; namespace isolation enforced; contextual compression reduces tokens 2-5x; vector compression reduces storage 60%+; custom scoring boosts applied; improved retrieval precision

### Namespace Management (Layer 6)
- **Functionality**: Create and manage isolated namespaces for multitenancy with per-tenant vector partitioning and metadata filtering
- **Purpose**: Enable strong tenant isolation, improve query performance through scope reduction, and enforce data governance policies
- **Trigger**: User creates namespace or configures tenant isolation in Azure Configuration
- **Progression**: Create namespace → Set tenant and environment → Enable compression per namespace → Attach metadata filters (doc_type, source, pii_flag) → Index documents with namespace → Query with isolation
- **Success criteria**: Zero cross-tenant data leakage; <500ms query latency with namespace filtering; metadata filters functional; support for 1000+ tenants

### Streaming Completions (Layer 8)
- **Functionality**: Real-time token streaming from Azure OpenAI for interactive user experience with stored completions for governance
- **Purpose**: Provide immediate feedback during generation and enable offline evaluation, prompt hardening, and compliance tracking
- **Trigger**: Query response generation with streaming enabled
- **Progression**: Generate embedding → Hybrid search with RRF → Compress context → Stream Azure OpenAI completion → Display tokens in real-time → Store completion for evaluation
- **Success criteria**: <200ms time-to-first-token; smooth streaming UX; stored completions captured; production resilience (retry, circuit-breaking)

### Configuration Management
- **Functionality**: Secure storage and management of Azure service credentials
- **Purpose**: Enable users to connect their own Azure resources
- **Trigger**: Initial app setup or configuration change
- **Progression**: Settings panel → Input credentials → Validate connection → Store securely → Enable features
- **Success criteria**: Successful connection validation and persistent configuration

### GitHub Repository Ingestion
- **Functionality**: Import and index files from public or private GitHub repositories
- **Purpose**: Enable knowledge base creation from code documentation, markdown files, and other repository content
- **Trigger**: User provides repository details in Integrations tab
- **Progression**: Input owner/repo/branch → Validate access → Fetch text files recursively → Chunk content → Generate embeddings → Index documents
- **Success criteria**: All text files successfully ingested; repository structure preserved; source links maintained

### Website Scraping
- **Functionality**: Crawl and extract content from websites with configurable depth and page limits
- **Purpose**: Build knowledge bases from documentation sites, blogs, and web content
- **Trigger**: User provides website URL and configuration in Integrations tab
- **Progression**: Input URL → Configure depth/limits → Validate accessibility → Crawl pages → Extract text → Remove scripts/nav/footer → Chunk content → Index documents
- **Success criteria**: Pages scraped within limits; clean text extraction; proper URL normalization; source links maintained

### Dropbox Integration
- **Functionality**: Sync and index text files from Dropbox folders using OAuth access tokens
- **Purpose**: Enable knowledge base creation from user's cloud-stored documents
- **Trigger**: User provides Dropbox access token in Integrations tab
- **Progression**: Input token → Validate connection → List files recursively → Filter text files → Download content → Chunk and index → Maintain sync metadata
- **Success criteria**: All text files ingested; folder structure tracked; source paths preserved

### OneDrive Integration
- **Functionality**: Sync and index files from OneDrive using Microsoft Graph API
- **Purpose**: Enable knowledge base creation from Microsoft cloud storage
- **Trigger**: User provides OneDrive access token in Integrations tab
- **Progression**: Input token → Validate Graph API access → Traverse folders → Filter text files → Download content → Chunk and index → Track item IDs
- **Success criteria**: Files successfully ingested; Microsoft Graph API properly utilized; source metadata maintained


## Edge Case Handling
- **Query Ambiguity**: Classification agent identifies unclear queries and prompts for clarification
- **Retrieval Failures**: Automatic fallback from Azure to local search with transparent user notification
- **Agent Loop Prevention**: Maximum iteration limits (3-5) with explicit exit conditions to prevent infinite reasoning loops
- **Conflicting Information**: Critic agent identifies contradictions and presents multiple perspectives
- **Authentication Failures**: Clear error messages with troubleshooting guidance and retry mechanisms
- **Service Unavailability**: Graceful degradation from agentic to basic RAG with user notification
- **Large Documents**: Streaming progress with intelligent chunking agent adapting strategy to content type
- **Invalid Configurations**: Input validation with helpful error messages and example values
- **Network Errors**: Exponential backoff retry with user feedback on retry attempts
- **Context Overflow**: Automatic context compression and summarization when token limits approached
- **Stale Cache Detection**: Automatic identification and cleanup of expired cache entries with configurable TTL by content type
- **Embedding Drift**: Version-based tracking prevents outdated embeddings; automatic invalidation on version mismatch
- **Concurrent Refresh Operations**: Progress tracking prevents duplicate refresh operations on same documents
- **Cache Pressure**: Adaptive TTL shortening for rarely-accessed entries to manage storage efficiently
- **GitHub Rate Limiting**: Automatic detection and user guidance for providing personal access tokens
- **Private Repository Access**: Token-based authentication support with secure storage
- **Website Robots.txt**: Respect crawling restrictions and provide user warnings
- **Broken Links**: Skip and log inaccessible pages during website scraping
- **OAuth Token Expiry**: Clear error messages prompting users to refresh tokens for Dropbox/OneDrive
- **Large Repository Ingestion**: Progress indicators and ability to specify path filters
- **Binary File Detection**: Automatic filtering to prevent ingestion of non-text files
- **Duplicate Sources**: Detection and user notification when same content exists from multiple sources
- **Namespace Isolation Failures**: Validation ensures queries only access authorized namespaces; error if namespace doesn't exist
- **Compression Recall Degradation**: Monitoring compression impact on recall; automatic fallback if quality drops below threshold
- **RRF Parameter Tuning**: A/B testing framework for maxTextRecallSize optimization per use case
- **Streaming Connection Drops**: Automatic reconnection and resume for interrupted Azure OpenAI streams
- **Rate Limit Handling**: Circuit breaker pattern prevents cascade failures; exponential backoff for 429 errors
- **Cross-Tenant Data Leakage**: Strict metadata filtering validation; audit logs for namespace access patterns
- **Vector Compression Quality**: Recall monitoring per namespace; rollback capability for compression settings
- **Stored Completion Failures**: Non-blocking storage errors; fallback to in-memory logging if persistence fails

## Design Direction
The design should feel professional and intelligent, showcasing the sophisticated agentic reasoning happening behind the scenes while remaining approachable. The interface should make visible the agent decision-making process through thoughtful status indicators and reasoning displays, conveying transparency and building user trust in AI decision-making.

## Color Selection
Custom palette - A professional blue-based scheme that conveys trust and intelligence while maintaining excellent readability.

- **Primary Color**: Professional Blue (oklch(0.45 0.15 260)) - Conveys trust, intelligence, and enterprise reliability
- **Secondary Colors**: Light gray backgrounds (oklch(0.96 0.005 240)) for subtle content separation and warm accent touches
- **Accent Color**: Deep charcoal (oklch(0.10 0.005 240)) for attention-grabbing highlights and important status indicators
- **Foreground/Background Pairings**: 
  - Background (Pure White oklch(1.00 0 0)): Dark text (oklch(0.10 0.005 240)) - Ratio 15.8:1 ✓
  - Primary (Professional Blue oklch(0.45 0.15 260)): White text (oklch(1.00 0 0)) - Ratio 9.2:1 ✓
  - Secondary (Light Gray oklch(0.96 0.005 240)): Dark text (oklch(0.35 0.008 240)) - Ratio 12.1:1 ✓
  - Accent (Deep Charcoal oklch(0.10 0.005 240)): White text (oklch(1.00 0 0)) - Ratio 15.8:1 ✓

## Font Selection
Typography should convey professionalism and technical competence while maintaining excellent readability for extended document review sessions.

- **Typographic Hierarchy**:
  - H1 (App Title): IBM Plex Sans Bold/32px/tight letter spacing
  - H2 (Section Headers): IBM Plex Sans Semibold/24px/normal spacing
  - H3 (Component Titles): IBM Plex Sans Medium/18px/normal spacing
  - Body Text: IBM Plex Sans Regular/14px/relaxed line height
  - Code/Technical: Source Code Pro Regular/13px/monospace clarity
  - Alternative Headers: Roboto Slab for emphasis/variety

## Animations
Animations should convey intelligent system behavior and agent activity, emphasizing the sophisticated reasoning process while maintaining professional polish.

- **Purposeful Meaning**: Animations reveal agent thinking process, route selection, and iterative refinement to build user confidence in AI decisions
- **Hierarchy of Movement**: Query classification indicators, agent workflow progression, retrieval strategy selection, and validation states deserve primary animation focus; subtle pulsing for active agent thinking; smooth transitions between workflow stages

## Component Selection
- **Components**: Cards for agent workflow display, scaling metrics, integration sources, and architecture layers, Timeline for multi-step reasoning visualization, Progress with agent stage indicators and refresh operations, Tabs for feature organization (Query/Upload/Integrations/Knowledge/Scaling/Azure/Architecture), Alerts for agent decisions, refresh results, and validation feedback, Badges for query complexity, retrieval strategy, cache status, volatility levels, source type indicators, and layer interactions, Accordions for reasoning transparency and source citations, Collapsible sections for sub-query breakdown and architecture details, Interactive buttons for suggested questions with cached indicators and layer selection, Sliders for website scraping configuration (depth/pages) and embedding quality tuning (recency/length/metadata weights), Switches for semantic search, vector compression, and custom scoring toggles, Select dropdowns for compression method selection, ScrollArea for architecture diagram navigation
- **Customizations**: Agent workflow visualization component, query classification indicator, reasoning step timeline, retrieval strategy selector with visual feedback, critic validation display, suggested questions component with category badges and caching indicators, specialized loading states showing which agent is active, scaling dashboard with refresh progress and metrics visualization, cache invalidation history timeline, volatility-based color coding, integration source cards with validation states, source type badges with icons (GitHub/Website/Dropbox/OneDrive/Upload), embedding optimization panel with semantic search configuration, vector compression settings and custom scoring profile tuners, 14-layer architecture diagram with interactive layer exploration, component detail cards with technologies and patterns, cross-cutting concern visualization for security and observability
- **States**: Query interface (idle/classifying/planning/retrieving/generating/validating/expanding), agent cards (thinking/acting/complete/error), document processing (analyzing/chunking/embedding/indexing), configuration (connected/disconnected/degraded), suggested questions (clickable/loading/disabled/cached), refresh operations (idle/scanning/processing/completed), cache entries (fresh/stale/invalidated), integration sources (validating/validated/ingesting/completed/error), optimization settings (enabled/disabled/configuring), architecture layers (default/selected/hovered), component details (collapsed/expanded)
- **Icon Selection**: Brain for AI reasoning, Route for query routing, Tree for query decomposition, MagnifyingGlass for retrieval, Shield for validation/critic, Cloud for Azure services, Check for validation success, Sparkle for query expansion and semantic search, Question for clarification category, TreeStructure for related topics and architecture, Lightbulb for deeper insights, ArrowsOutSimple for broader context, Lightning for cached results and vector compression, Database for embeddings, ArrowsClockwise for refresh, ChartBar for metrics, Trash for cleanup operations, Clock for TTL/age, Warning for high volatility, GithubLogo for GitHub source, Globe for website source, DropboxLogo for Dropbox source, MicrosoftOutlookLogo for OneDrive source, Upload for manual upload source, PlugsConnected for integrations tab, Users for presentation layer, ShieldCheck for security layer, GitBranch for orchestration, Cube for LLM services, CloudArrowUp for vector store, Eye for observability, Lock for security features, HardDrives for document store, Gear for infrastructure, ArrowRight for layer interactions
- **Spacing**: Generous padding (1.5rem) for agent workflow cards, scaling dashboard, integration cards, optimization panels, and architecture layer cards, consistent gaps (1rem) for reasoning steps, metrics grids, and component details, tight spacing (0.5rem) for inline indicators and badges, extra space (2rem) between major workflow stages and architecture sections, comfortable spacing (0.5rem) between suggested questions and architecture layers, grid layouts (2-4 columns) for integration tabs, metrics display, and architecture principles, slider controls with clear labels and value displays, architectural diagram with vertical flow and connection indicators
- **Mobile**: Agent workflow timeline becomes vertical, reasoning steps stack with full width, query interface adapts with collapsible agent details, configuration forms single-column, document cards stack with essential info prioritized, suggested questions display full width with stacked layout, scaling dashboard metrics collapse to single column, refresh operations show simplified progress, integration tabs stack vertically with single-column forms, optimization settings stack vertically with full-width sliders and switches, architecture diagram stacks vertically with full-width layer cards, tabs become dropdown selector, component details expand to full width, interaction badges wrap naturally