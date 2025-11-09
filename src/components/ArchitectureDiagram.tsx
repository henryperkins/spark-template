import { useState, type ReactNode, type CSSProperties } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Users,
  Globe,
  ShieldCheck,
  Brain,
  GitBranch,
  Database,
  CloudArrowUp,
  ChartBar,
  ArrowsDownUp,
  Gear,
  TreeStructure,
  Cube,
  HardDrives,
  Eye,
  Lock,
  ArrowRight,
  Circle,
  CheckCircle,
  Lightning
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

type ArchitectureLayerAccent =
  | 'presentation'
  | 'runtime'
  | 'security'
  | 'orchestration'
  | 'agents'
  | 'llm-services'
  | 'retrieval'
  | 'vector-store'
  | 'embedding'
  | 'document-processing'
  | 'document-store'
  | 'cache'
  | 'observability'
  | 'infrastructure'

interface ArchitectureLayer {
  id: string
  name: string
  description: string
  components: string[]
  icon: ReactNode
  accent: ArchitectureLayerAccent
  interactions: string[]
}

interface ComponentDetail {
  name: string
  purpose: string
  technologies: string[]
  patterns: string[]
}

const getLayerAccentStyles = (accent: ArchitectureLayerAccent): CSSProperties => ({
  backgroundColor: `var(--layer-${accent})`,
  color: `var(--layer-${accent}-foreground)`
})

export function ArchitectureDiagram() {
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null)

  const layers: ArchitectureLayer[] = [
    {
      id: 'presentation',
      name: '1. Presentation Layer',
      description: 'User-facing interfaces and interaction points',
      components: [
        'React 19 SPA with TypeScript',
        'shadcn/ui Components (40+ components)',
        'AgentWorkflowVisualizer',
        'QueryInterface (Chat & Single)',
        'DocumentUpload & DocumentList',
        'Integrations Hub (GitHub/Web/Dropbox/OneDrive)',
        'ScalingDashboard',
        'ArchitectureDiagram'
      ],
      icon: <Users size={20} />,
      accent: 'presentation',
      interactions: ['Cloudflare Worker runtime', 'Agent Orchestration', 'Browser KV Store']
    },
    {
      id: 'runtime',
      name: '2. Edge Runtime Layer',
      description: 'Cloudflare Worker edge runtime exposing hardened APIs for storage, logs, and migration.',
      components: [
        'Cloudflare Worker API gateway (/api/*)',
        'RAG_KV namespace bridge with typed bindings',
        'Bearer-gated /api/logs with R2 Logpush access',
        'Secure /api/kv CRUD with CORS enforcement',
        'One-shot /api/migrate for legacy KV backfill',
        'Static asset delivery for Vite SPA'
      ],
      icon: <Globe size={20} />,
      accent: 'runtime',
      interactions: ['Presentation Layer', 'Security Layer', 'Observability Layer', 'Document Store']
    },
    {
      id: 'security',
      name: '3. Security Layer',
      description: 'Client-side security and sensitive data management',
      components: [
        'Azure API Key Storage (Browser KV)',
        'GitHub Token Management',
        'Dropbox/OneDrive OAuth Tokens',
        'Client-side Validation',
        'HTTPS Enforcement',
        'Cross-Origin Security'
      ],
      icon: <ShieldCheck size={20} />,
      accent: 'security',
      interactions: ['Azure Services', 'Integration APIs', 'Browser Storage']
    },
    {
      id: 'orchestration',
      name: '4. Agent Orchestration Layer',
      description: 'Coordinates multi-agent workflows, KB context, budgets, and telemetry',
      components: [
        'AgenticOrchestrator Engine',
        'KB Context Propagation (all agents)',
        'Workflow Step Tracking',
        'Budget Guards (tokens/time)',
        'Phase Timing + Tokens/Cost Telemetry',
        'Error Recovery & Fallbacks',
        'State Management'
      ],
      icon: <Brain size={20} />,
      accent: 'orchestration',
      interactions: ['Agent Layer', 'Retrieval Layer', 'LLM Services', 'Observability Layer', 'Cache Layer']
    },
    {
      id: 'agents',
      name: '5. Agent Layer',
      description: 'Specialized AI agents for different RAG tasks (KB-aware)',
      components: [
        'QueryClassifierAgent (complexity analysis, KB-aware)',
        'QueryPlannerAgent (decomposition; small-KB limits)',
        'RoutingAgent (vector/keyword/hybrid; embeddings/content-type aware)',
        'DocumentAnalyzerAgent (chunking strategy, ingestion-only, optional)',
        'CriticAgent (faithfulness thresholds by content type)',
        'ReActAgent (iterative refinement; budget-aware)',
        'QueryExpansionAgent (KB-aware related questions)'
      ],
      icon: <GitBranch size={20} />,
      accent: 'agents',
      interactions: ['LLM Services', 'Retrieval Layer', 'Cache Layer', 'Observability Layer']
    },
    {
      id: 'llm-services',
      name: '6. LLM Services Layer',
      description: 'Language model integration via Edge LLM proxy and Azure',
      components: [
        'Edge LLM proxy (/api/llm)',
        'Azure OpenAI Integration (optional)',
        'Prompt Engineering Templates',
        'JSON Mode Parsing',
        'Response Streaming',
        'Token Management'
      ],
      icon: <Cube size={20} />,
      accent: 'llm-services',
      interactions: ['Worker runtime', 'Agent Layer', 'Azure OpenAI']
    },
    {
      id: 'retrieval',
      name: '7. Retrieval Layer',
      description: 'Document retrieval with multiple search strategies',
      components: [
        'Vector Similarity Search',
        'Keyword/BM25 Search',
        'Hybrid Search Fusion',
        'Azure AI Search Integration',
        'Result Ranking & Scoring',
        'Relevance Filtering'
      ],
      icon: <Database size={20} />,
      accent: 'retrieval',
      interactions: ['Vector Store', 'Azure AI Search', 'Cache Layer']
    },
    {
      id: 'vector-store',
      name: '8. Vector Store Layer',
      description: 'Embeddings storage with dual-mode support',
      components: [
        'Browser In-Memory Vector Store',
        'Azure AI Search (optional)',
        'Vector Compression (Scalar/Binary)',
        'HNSW Indexing (Azure)',
        'Embedding Version Management',
        'Namespace Isolation'
      ],
      icon: <CloudArrowUp size={20} />,
      accent: 'vector-store',
      interactions: ['Embedding Service', 'Azure AI Search', 'Document Store']
    },
    {
      id: 'embedding',
      name: '9. Embedding Service Layer',
      description: 'Text-to-vector transformation with intelligent caching',
      components: [
        'Azure OpenAI Embeddings API',
        'EmbeddingManager (refresh logic)',
        'Batch Processing',
        'Checksum-based Change Detection',
        'Embedding Cache',
        'Version Control'
      ],
      icon: <Lightning size={20} />,
      accent: 'embedding',
      interactions: ['Azure OpenAI', 'Vector Store', 'Cache Layer']
    },
    {
      id: 'document-processing',
      name: '10. Document Processing Layer',
      description: 'Ingestion, intelligent chunking, and metadata extraction',
      components: [
        'File Upload (browser-based)',
        'GitHub Repository Ingestion',
        'Website Crawling & Scraping',
        'Dropbox Integration',
        'OneDrive Integration',
        'Intelligent Chunking (4 strategies)',
        'Metadata Extraction',
        'Deduplication'
      ],
      icon: <TreeStructure size={20} />,
      accent: 'document-processing',
      interactions: ['Document Store', 'Embedding Service', 'Integration APIs']
    },
    {
      id: 'document-store',
      name: '11. Document Store Layer',
      description: 'Document persistence using Cloudflare KV',
      components: [
        'useStorage Hook (rag-documents key)',
        'Document Metadata Storage',
        'Chunk Storage & Indexing',
        'Processing Status Tracking',
        'Source Attribution',
        'Version Tracking'
      ],
      icon: <HardDrives size={20} />,
      accent: 'document-store',
      interactions: ['Worker KV API', 'Document Processing', 'Vector Store']
    },
    {
      id: 'cache',
      name: '12. Caching Layer',
      description: 'Multi-level caching with intelligent invalidation',
      components: [
        'CacheManager (centralized)',
        'Query Result Cache (TTL-based)',
        'Embedding Cache',
        'LLM Response Cache',
        'Prefix-based Invalidation',
        'Semantic Drift Detection',
        'Cache Metrics Tracking'
      ],
      icon: <ArrowsDownUp size={20} />,
      accent: 'cache',
      interactions: ['Cloudflare KV store', 'All Service Layers', 'Scaling Dashboard']
    },
    {
      id: 'observability',
      name: '13. Observability Layer',
      description: 'Monitoring, metrics, and workflow visualization',
      components: [
        'AgentWorkflowVisualizer',
        'ScalingDashboard (metrics + telemetry)',
        'Cache Hit Rate Monitoring',
        'Error Tracking, Analytics Emission, UI Surfacing',
        'Quality Metrics (faithfulness, relevance)',
        'Tokens/Cost & Phase Timing Dashboards'
      ],
      icon: <Eye size={20} />,
      accent: 'observability',
      interactions: ['Orchestration Layer', 'Cache Layer', 'Document Processing Layer', 'LLM Services Layer', 'UI Components']
    },
    {
      id: 'infrastructure',
      name: '14. Infrastructure Layer',
      description: 'Runtime environment and external services',
      components: [
        'Cloudflare Workers Edge Runtime',
        'Vite Build System',
        'Azure OpenAI Services (optional)',
        'Azure AI Search (optional)',
        'GitHub API',
        'Dropbox/OneDrive APIs',
        'Browser APIs (File, Fetch, Storage)'
      ],
      icon: <Gear size={20} />,
      accent: 'infrastructure',
      interactions: ['All Layers - Foundation']
    }
  ]

  const componentDetails: Record<string, ComponentDetail[]> = {
    'presentation': [
      {
        name: 'QueryInterface',
        purpose: 'Dual-mode chat and single-query interface with agentic workflow visualization',
        technologies: ['React 19', 'TypeScript', 'shadcn/ui', 'useStorage persistence'],
        patterns: ['Component Composition', 'Controlled Components', 'State Lifting']
      },
      {
        name: 'AgentWorkflowVisualizer',
        purpose: 'Real-time visualization of agent decision-making process with step-by-step timeline',
        technologies: ['React', 'Phosphor Icons', 'shadcn Badge/Card', 'Framer Motion'],
        patterns: ['Timeline Visualization', 'Progressive Disclosure', 'Real-time Updates']
      },
      {
        name: 'DocumentUpload & DocumentList',
        purpose: 'File upload with drag-and-drop and comprehensive document management',
        technologies: ['File API', 'useStorage', 'shadcn Table'],
        patterns: ['File Upload', 'Optimistic UI', 'List Management']
      },
      {
        name: 'Integrations Hub',
        purpose: 'Unified interface for GitHub, website, Dropbox, and OneDrive ingestion',
        technologies: ['GitHub API', 'Octokit', 'Web Scraping', 'OAuth'],
        patterns: ['Plugin Architecture', 'Multi-source Ingestion', 'Error Handling']
      }
    ],
    'runtime': [
      {
        name: 'Edge API Gateway',
        purpose: 'Cloudflare Worker entry point serving the SPA and enforcing CORS, auth, and error handling for every /api/* route.',
        technologies: ['Cloudflare Workers', 'TypeScript', 'CORS Middleware'],
        patterns: ['API Gateway', 'Zero-Trust Edge', 'Structured Logging']
      },
      {
        name: 'KV Bridge & Migration',
        purpose: 'Bridges RAG_KV and optional LEGACY_KV namespaces with batched pagination, prefix filters, and dry-run support.',
        technologies: ['Cloudflare KV', 'Cursor Pagination', 'JSON Serialization'],
        patterns: ['Data Migration', 'Idempotent Writes', 'Batch Processing']
      },
      {
        name: 'Log & Telemetry Surface',
        purpose: 'Bearer-protected /api/logs endpoint exposing R2 Logpush data with list/get/recent actions.',
        technologies: ['Cloudflare R2', 'Logpush', 'Bearer Auth'],
        patterns: ['Observability', 'Audit Logging', 'Secure Telemetry']
      },
      {
        name: 'Static Asset Delivery',
        purpose: 'Serves Vite build artifacts through the ASSETS binding with cache-friendly SPA routing.',
        technologies: ['Cloudflare Asset Binding', 'Vite Build Output', 'HTTP Caching'],
        patterns: ['Static Hosting', 'Edge Caching', 'SPA Delivery']
      }
    ],
    'agents': [
      {
        name: 'QueryClassifierAgent',
        purpose: 'Analyzes query complexity (simple/moderate/complex) with KB context hints',
        technologies: ['Edge LLM proxy (/api/llm)', 'JSON mode', 'Complexity scoring'],
        patterns: ['Classification Pipeline', 'Strategy Pattern', 'Confidence Scoring']
      },
      {
        name: 'QueryPlannerAgent',
        purpose: 'Decomposes complex queries into focused sub-queries; limits to max 2 when KB is small (<5 docs)',
        technologies: ['LLM-based Planning', 'Dependency Analysis'],
        patterns: ['Divide and Conquer', 'Query Decomposition', 'Parallel Execution']
      },
      {
        name: 'RoutingAgent',
        purpose: 'Selects optimal retrieval strategy (vector/keyword/hybrid) using embeddings availability and content-type (code → keyword, technical → hybrid)',
        technologies: ['Decision Logic', 'Confidence Scoring'],
        patterns: ['Router Pattern', 'Strategy Selection', 'Heuristic Analysis']
      },
      {
        name: 'DocumentAnalyzerAgent',
        purpose: 'Determines optimal chunking strategy (paragraph/sentence/semantic/fixed)',
        technologies: ['Content Analysis', 'Pattern Matching'],
        patterns: ['Strategy Pattern', 'Content Analysis', 'Adaptive Processing']
      },
      {
        name: 'CriticAgent',
        purpose: 'Validates response quality and identifies hallucinations; faithfulness thresholds tuned (technical: 0.7, prose: 0.6)',
        technologies: ['Edge LLM proxy (/api/llm)', 'Faithfulness Analysis', 'Source Verification'],
        patterns: ['Validator Pattern', 'Quality Gates', 'Dual-Agent Verification']
      },
      {
        name: 'ReActAgent',
        purpose: 'Iteratively refines responses through Reason-Act-Observe loops; adapts iteration count to remaining token budget',
        technologies: ['ReAct Framework', 'Multi-step Reasoning'],
        patterns: ['Iterative Refinement', 'Self-Correction', 'Thought-Action-Observation']
      },
      {
        name: 'QueryExpansionAgent',
        purpose: 'Generates 4 types of related questions (clarification/related/deeper/broader) tailored to KB content type',
        technologies: ['Edge LLM proxy (/api/llm)', 'Question Generation', 'Cache Integration'],
        patterns: ['Content Discovery', 'Recommendation Engine', 'Cache-Aside']
      }
    ],
    'orchestration': [
      {
        name: 'AgenticOrchestrator',
        purpose: 'Coordinates agent execution; builds KB context; enforces time/token budgets; emits telemetry',
        technologies: ['TypeScript', 'Async/Await', 'Promise.all', 'Context Store'],
        patterns: ['Orchestration Pattern', 'Pipeline', 'Error Handling', 'Budget Guard']
      },
      {
        name: 'Workflow Step Tracking',
        purpose: 'Records each agent action with timing for visualization',
        technologies: ['Timestamp Tracking', 'Duration Calculation'],
        patterns: ['Observer Pattern', 'Event Logging', 'Timeline Generation']
      },
      {
        name: 'Telemetry Enrichment',
        purpose: 'Emits cumulative tokens/cost and agent-specific metadata (strategy, scores, iterations)',
        technologies: ['Runtime Telemetry', 'Token Tracker'],
        patterns: ['Structured Events', 'Cumulative Metrics']
      },
      {
        name: 'Budget Guards',
        purpose: 'Skips expansion/refinement if remaining token budget is below calibrated thresholds',
        technologies: ['Budget Calculator'],
        patterns: ['Fail-Fast', 'Graceful Degradation']
      }
    ],
    'retrieval': [
      {
        name: 'Hybrid Retrieval Engine',
        purpose: 'Combines vector similarity with keyword matching for comprehensive results',
        technologies: ['Cosine Similarity', 'BM25 Algorithm', 'Score Fusion'],
        patterns: ['Hybrid Search', 'Score Normalization', 'Result Merging']
      },
      {
        name: 'Azure AI Search Integration',
        purpose: 'Enterprise-grade vector search with semantic ranking capabilities',
        technologies: ['Azure AI Search API', 'HNSW Algorithm', 'Semantic Reranker'],
        patterns: ['External Service Integration', 'Fallback Strategy', 'Error Handling']
      }
    ],
    'embedding': [
      {
        name: 'EmbeddingManager',
        purpose: 'Manages embedding lifecycle with incremental refresh and version control',
        technologies: ['Azure OpenAI Embeddings', 'Checksum Comparison', 'Namespace Versioning'],
        patterns: ['Incremental Update', 'Version Management', 'Change Detection']
      },
      {
        name: 'Embedding Cache',
        purpose: 'Caches embeddings to avoid redundant API calls',
        technologies: ['In-Memory Cache', 'TTL Management'],
        patterns: ['Cache-Aside', 'Lazy Loading', 'Invalidation']
      }
    ],
    'cache': [
      {
        name: 'CacheManager',
        purpose: 'Centralized multi-level caching with intelligent invalidation strategies',
        technologies: ['Cloudflare KV', 'TTL Management', 'Prefix Matching', 'Cosine Similarity'],
        patterns: ['Cache-Aside', 'Write-Through', 'Invalidation Strategies']
      },
      {
        name: 'Semantic Drift Detection',
        purpose: 'Identifies when cached embeddings diverge from current model using cosine similarity',
        technologies: ['Cosine Similarity', 'Threshold Monitoring (0.95)'],
        patterns: ['Anomaly Detection', 'Continuous Validation', 'Automated Invalidation']
      }
    ],
    'document-processing': [
      {
        name: 'Intelligent Chunking',
        purpose: 'Adaptive chunking with 4 strategies (paragraph/sentence/semantic/fixed)',
        technologies: ['NLP Heuristics', 'Overlap Management', 'Boundary Detection'],
        patterns: ['Strategy Pattern', 'Configurable Overlap', 'Content-Aware Splitting']
      },
      {
        name: 'Multi-Source Ingestion',
        purpose: 'Unified ingestion from files, GitHub, websites, Dropbox, OneDrive',
        technologies: ['File API', 'GitHub API', 'Web Scraping', 'OAuth'],
        patterns: ['Adapter Pattern', 'Source Attribution', 'Metadata Preservation']
      }
    ],
    'security': [
      {
        name: 'Client-side KV Storage',
        purpose: 'Browser-based storage for Azure API keys using Cloudflare KV (via Worker) with localStorage fallback',
        technologies: ['Worker KV API', 'localStorage', 'Cloudflare KV REST API'],
        patterns: ['Secure Storage', 'Runtime Detection', 'Fallback Strategy']
      },
      {
        name: 'OAuth Token Management',
        purpose: 'Manages access tokens for GitHub, Dropbox, OneDrive integrations',
        technologies: ['Bearer Tokens', 'OAuth 2.0', 'Token Refresh'],
        patterns: ['Token Lifecycle', 'Secure Transmission', 'Client-side Validation']
      },
      {
        name: 'Input Sanitization',
        purpose: 'Sanitizes user queries to prevent prompt injection and jailbreak attempts',
        technologies: ['Regex Filtering', 'PII Redaction', 'Length Enforcement'],
        patterns: ['Input Validation', 'Prompt Safety', 'Content Filtering']
      }
    ],
    'llm-services': [
      {
        name: 'LLMService',
        purpose: 'Unified LLM interface with Azure OpenAI primary and Worker proxy fallback',
        technologies: ['Azure OpenAI', 'Edge LLM proxy', 'Token Bucket Rate Limiting'],
        patterns: ['Provider Abstraction', 'Retry with Backoff', 'Timeout Management']
      },
      {
        name: 'Prompt Engineering',
        purpose: 'Utilities for sanitization, tokenization, truncation, and JSON output enforcement',
        technologies: ['tiktoken', 'Prompt Templates', 'Context Truncation'],
        patterns: ['Template Method', 'Token Estimation', 'Safe Interpolation']
      },
      {
        name: 'Response Parsing',
        purpose: 'Parses JSON from LLM responses with robust extraction (direct parse, fenced code blocks, balanced braces) and exposes rawText on EPARSE for repair agents',
        technologies: ['JSON.parse', 'Balanced Brace Scan', 'Markdown Fence Extraction', 'Error Recovery'],
        patterns: ['Lenient Parsing', 'Fallback Chain', 'Schema Validation (Zod)', 'EPARSE with rawText for downstream repair']
      }
    ],
    'vector-store': [
      {
        name: 'In-Memory Vector Store',
        purpose: 'Browser-based vector storage with cosine similarity search',
        technologies: ['JavaScript Arrays', 'Cosine Similarity', 'Embedding Cache'],
        patterns: ['In-Memory Index', 'Linear Scan', 'Score Normalization']
      },
      {
        name: 'Azure AI Search Integration',
        purpose: 'Enterprise vector search with HNSW indexing, semantic ranking, and compression',
        technologies: ['Azure AI Search API', 'HNSW Algorithm', 'Scalar/Binary Compression'],
        patterns: ['External Index', 'Hybrid Search', 'Semantic Reranking']
      },
      {
        name: 'Vector Namespace Management',
        purpose: 'Isolates embeddings by version, tenant, and environment with namespace isolation',
        technologies: ['Namespace Manager', 'Checksum-based Versioning'],
        patterns: ['Multi-tenancy', 'Version Control', 'Namespace Isolation']
      }
    ],
    'document-store': [
      {
        name: 'useStorage Hook',
        purpose: 'React hook for persistent document storage with automatic sync to Cloudflare KV or localStorage',
        technologies: ['React Hooks', 'Cloudflare KV', 'localStorage'],
        patterns: ['Custom Hook', 'Auto-sync', 'Optimistic Updates']
      },
      {
        name: 'Document Metadata Storage',
        purpose: 'Stores document metadata including source, processing status, Azure indexing state',
        technologies: ['JSON Serialization', 'KV Namespacing (rag-documents)'],
        patterns: ['Metadata Schema', 'Status Tracking', 'Source Attribution']
      },
      {
        name: 'Chunk Storage & Indexing',
        purpose: 'Stores document chunks with embeddings, chunkIndex, and optional Azure vectorId',
        technologies: ['Structured Clone', 'Embedding Arrays', 'Chunk Metadata'],
        patterns: ['Hierarchical Storage', 'Chunk Versioning', 'ID Generation']
      }
    ],
    'observability': [
      {
        name: 'AgentWorkflowVisualizer',
        purpose: 'Real-time timeline visualization of agent steps with status, duration, and results',
        technologies: ['Framer Motion', 'React State', 'Phosphor Icons'],
        patterns: ['Timeline UI', 'Progressive Disclosure', 'Live Updates']
      },
      {
        name: 'Telemetry Service',
        purpose: 'Emits agent step events and alerts to Worker telemetry with fallback console logging',
        technologies: ['Worker Telemetry (/api/telemetry)', 'Structured Events'],
        patterns: ['Event Emission', 'Telemetry Sink Abstraction', 'Dev Fallback']
      },
      {
        name: 'Error Tracking Service',
        purpose: 'Classifies, aggregates, and analyzes errors by type (LLM, retrieval, network) and agent',
        technologies: ['In-Memory Store', 'Error Classification', 'Metrics Aggregation'],
        patterns: ['Error Categorization', 'Retention Limit', 'Trend Analysis']
      },
      {
        name: 'Token & Cost Tracker',
        purpose: 'Tracks LLM token usage, estimates costs per model, enforces daily budgets with alerts',
        technologies: ['Model Pricing Tables', 'KV Budget Persistence'],
        patterns: ['Usage Metering', 'Budget Enforcement', 'Cost Estimation']
      }
    ],
    'infrastructure': [
      {
        name: 'Cloudflare Workers Runtime',
        purpose: 'Edge API gateway serving SPA, KV bridge, logs, Azure Search proxy, and migration endpoints',
        technologies: ['Cloudflare Workers', 'KV Bindings', 'R2 Logpush', 'CORS Middleware'],
        patterns: ['API Gateway', 'Bearer Auth', 'Structured Logging', 'Static Asset Serving']
      },
      {
        name: 'Vite Build System',
        purpose: 'Fast builds with React SWC, Tailwind CSS 4, and WASM support',
        technologies: ['Vite 6', 'SWC', 'Tailwind CSS', 'WASM Plugin'],
        patterns: ['Plugin Architecture', 'Path Aliases (@/*)']
      },
      {
        name: 'Runtime Environment Detection',
        purpose: 'Auto-detects Cloudflare Workers, KV config, Azure config to select storage and LLM providers',
        technologies: ['Environment Variables', 'Domain Detection (.workers.dev)'],
        patterns: ['Runtime Abstraction', 'Auto-configuration', 'Fallback Chains']
      },
      {
        name: 'Worker LLM Fallback System',
        purpose: 'Edge proxy or deterministic stub used when Azure is unavailable',
        technologies: ['Fetch Interception', 'In-Memory KV', 'Mock LLM Responses'],
        patterns: ['Transparent Fallback', 'Mode Switching', 'Auto-recovery']
      }
    ]
  }

  return (
    <div className="space-y-6">
      <div className="sr-only">
        This view presents a 14-layer architecture for a production-grade multi-agent RAG system.
        It starts from user interfaces and edge runtime, down through agents, retrieval, vector and
        document stores, caching and observability, and finally infrastructure. Use the tabs to
        explore the diagram, detailed layer breakdowns, and component catalog.
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <TreeStructure size={28} className="text-primary" />
            <div>
              <CardTitle className="text-2xl">Production Multi-Agent RAG Architecture</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                14 interconnected layers spanning from user interfaces to infrastructure
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="diagram" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="diagram">Architecture Diagram</TabsTrigger>
              <TabsTrigger value="layers">Layer Details</TabsTrigger>
              <TabsTrigger value="components">Component Catalog</TabsTrigger>
            </TabsList>

            <TabsContent value="diagram" className="space-y-4 mt-6">
              <div className="bg-muted/30 p-6 rounded-lg border-2 border-border">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg">System Architecture Overview</h3>
                  <Badge variant="outline">14 Layers</Badge>
                </div>

                <ScrollArea className="h-[600px] pr-4">
                  <div className="space-y-3">
                    {layers.map((layer, index) => (
                      <div key={layer.id}>
                        <Card
                          className={cn(
                            "transition-all cursor-pointer hover:shadow-lg",
                            selectedLayer === layer.id && "ring-2 ring-primary shadow-lg",
                            hoveredLayer === layer.id && "scale-[1.02]"
                          )}
                          onMouseEnter={() => setHoveredLayer(layer.id)}
                          onMouseLeave={() => setHoveredLayer(null)}
                          onClick={() => setSelectedLayer(selectedLayer === layer.id ? null : layer.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-4">
                              <div
                                className="p-3 rounded-lg"
                                style={getLayerAccentStyles(layer.accent)}
                              >
                                {layer.icon}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-semibold text-sm">{layer.name}</h4>
                                  {selectedLayer === layer.id && (
                                    <CheckCircle size={16} className="text-primary" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mb-3">
                                  {layer.description}
                                </p>

                                {selectedLayer === layer.id && (
                                  <div className="space-y-3 animate-in slide-in-from-top-2">
                                    <div>
                                      <div className="text-xs font-medium mb-2 flex items-center gap-2">
                                        <Cube size={14} />
                                        Key Components {layer.components.length > 4 && <span className="text-muted-foreground font-normal">(showing top 4 of {layer.components.length})</span>}
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        {layer.components.slice(0, 4).map((component, idx) => (
                                          <Badge
                                            key={idx}
                                            variant="secondary"
                                            className="text-xs justify-start"
                                          >
                                            <Circle size={6} className="mr-1.5 flex-shrink-0" />
                                            {component}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs font-medium mb-2 flex items-center gap-2">
                                        <ArrowRight size={14} />
                                        Interactions {layer.interactions.length > 4 && <span className="text-muted-foreground font-normal">(showing top 4 of {layer.interactions.length})</span>}
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {layer.interactions.slice(0, 4).map((interaction, idx) => (
                                          <Badge
                                            key={idx}
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {interaction}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {index < layers.length - 1 && (
                          <div className="flex justify-center py-2">
                            <ArrowRight size={20} className="text-muted-foreground rotate-90" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex items-start gap-3">
                    <Eye size={20} className="text-primary mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-1">Cross-Cutting Concerns</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        These layers integrate horizontally across the architecture
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Badge variant="secondary" className="justify-start">
                          <Lock size={12} className="mr-1.5" />
                          Security: API Keys, OAuth, Client Validation
                        </Badge>
                        <Badge variant="secondary" className="justify-start">
                          <ChartBar size={12} className="mr-1.5" />
                          Observability: Workflow Viz, Metrics, Logging
                        </Badge>
                        <Badge variant="secondary" className="justify-start">
                          <ArrowsDownUp size={12} className="mr-1.5" />
                          Caching: Query/Embedding/LLM Response Caching
                        </Badge>
                        <Badge variant="secondary" className="justify-start">
                          <Cube size={12} className="mr-1.5" />
                          Edge Runtime: Worker APIs, KV bridge, Log access
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="layers" className="space-y-4 mt-6">
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-4" role="list" aria-label="Architecture layers">
                  {layers.map((layer) => (
                    <section
                      key={layer.id}
                      role="listitem"
                      aria-labelledby={`layer-${layer.id}-title`}
                    >
                      <Card>
                        <CardHeader>
                          <div className="flex items-center gap-3">
                            <div
                              className="p-2 rounded-lg"
                              style={getLayerAccentStyles(layer.accent)}
                            >
                              {layer.icon}
                            </div>
                            <div className="flex-1">
                              <CardTitle className="text-lg" id={`layer-${layer.id}-title`}>
                                {layer.name}
                              </CardTitle>
                              <p className="text-sm text-muted-foreground mt-1">
                                {layer.description}
                              </p>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <h4 className="font-semibold text-sm mb-2">Components</h4>
                          <div className="grid grid-cols-2 gap-2">
                            {layer.components.map((component, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 p-2 bg-muted/20 rounded text-xs"
                              >
                                <CheckCircle size={14} className="text-primary mt-0.5 flex-shrink-0" />
                                {component}
                              </div>
                            ))}
                          </div>
                        </div>

                        <Separator />

                        <div>
                          <h4 className="font-semibold text-sm mb-2">Layer Interactions</h4>
                          <div className="flex flex-wrap gap-2">
                            {layer.interactions.map((interaction, idx) => (
                              <Badge key={idx} variant="outline">
                                <ArrowRight size={12} className="mr-1" />
                                {interaction}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="components" className="space-y-4 mt-6">
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-6">
                  {Object.entries(componentDetails).map(([layerId, components], entryIdx) => {
                    const layer = layers.find(l => l.id === layerId)
                    if (!layer) return null

                    return (
                      <div key={layerId}>
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className="p-2 rounded-lg"
                            style={getLayerAccentStyles(layer.accent)}
                          >
                            {layer.icon}
                          </div>
                          <h3 className="font-semibold">{layer.name}</h3>
                        </div>

                        <div className="grid gap-3 ml-12">
                          {components.map((component, idx) => (
                            <Card key={idx} className="bg-muted/20">
                              <CardContent className="p-4">
                                <h4 className="font-semibold text-sm mb-2">{component.name}</h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                  {component.purpose}
                                </p>

                                <div className="space-y-2">
                                  <div>
                                    <span className="text-xs font-medium">Technologies:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {component.technologies.map((tech, i) => (
                                        <Badge key={i} variant="secondary" className="text-xs">
                                          {tech}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-xs font-medium">Patterns:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {component.patterns.map((pattern, i) => (
                                        <Badge key={i} variant="outline" className="text-xs">
                                          {pattern}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>

                        {entryIdx < Object.entries(componentDetails).length - 1 && (
                          <Separator className="my-6" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Architecture Principles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <TreeStructure size={16} className="text-primary" />
                Browser-First Architecture
              </h4>
              <p className="text-xs text-muted-foreground">
                Runs with a Cloudflare Worker runtime for LLM access and KV persistence, with optional Azure integration for production scale
              </p>
            </div>

            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <GitBranch size={16} className="text-primary" />
                Multi-Agent Orchestration
              </h4>
              <p className="text-xs text-muted-foreground">
                7 specialized agents (Classifier, Planner, Router, Analyzer, Critic, ReAct, Expansion) coordinated by AgenticOrchestrator for intelligent query processing
              </p>
            </div>

            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <ArrowsDownUp size={16} className="text-primary" />
                Intelligent Caching
              </h4>
              <p className="text-xs text-muted-foreground">
                Multi-level caching with TTL, prefix-based invalidation, and semantic drift detection achieving 80%+ cache hit rates
              </p>
            </div>

            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <ShieldCheck size={16} className="text-primary" />
                Hybrid Deployment Model
              </h4>
              <p className="text-xs text-muted-foreground">
                Operates standalone with browser storage or scales to Azure OpenAI and AI Search for enterprise workloads with advanced features
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
