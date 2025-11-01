import React, { useState } from 'react'
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
  Bug,
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

interface ArchitectureLayer {
  id: string
  name: string
  description: string
  components: string[]
  icon: React.ReactNode
  color: string
  interactions: string[]
}

interface ComponentDetail {
  name: string
  purpose: string
  technologies: string[]
  patterns: string[]
}

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
      color: 'bg-blue-500',
      interactions: ['Spark Runtime SDK', 'Agent Orchestration', 'Browser KV Store']
    },
    {
      id: 'runtime',
      name: '2. Spark Runtime Layer',
      description: 'Browser-based runtime with LLM and persistence APIs',
      components: [
        'spark.llm() API (GPT-4o, GPT-4o-mini)',
        'spark.kv persistence (get/set/delete/keys)',
        'useKV React hook',
        'spark.user() authentication',
        'JSON mode for structured outputs',
        'Client-side execution'
      ],
      icon: <Globe size={20} />,
      color: 'bg-cyan-500',
      interactions: ['Presentation Layer', 'LLM Services', 'Document Store']
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
      color: 'bg-red-500',
      interactions: ['Azure Services', 'Integration APIs', 'Browser Storage']
    },
    {
      id: 'orchestration',
      name: '4. Agent Orchestration Layer',
      description: 'Coordinates multi-agent workflows and decision-making',
      components: [
        'AgenticOrchestrator Engine',
        'Workflow Step Tracking',
        'Agent Communication Pipeline',
        'Error Recovery & Fallbacks',
        'Execution Timing Metrics',
        'State Management'
      ],
      icon: <Brain size={20} />,
      color: 'bg-purple-500',
      interactions: ['Agent Layer', 'Retrieval Layer', 'LLM Services']
    },
    {
      id: 'agents',
      name: '5. Agent Layer',
      description: 'Specialized AI agents for different RAG tasks',
      components: [
        'QueryClassifierAgent (complexity analysis)',
        'QueryPlannerAgent (decomposition)',
        'RoutingAgent (vector/keyword/hybrid)',
        'DocumentAnalyzerAgent (chunking strategy)',
        'CriticAgent (hallucination detection)',
        'ReActAgent (iterative refinement)',
        'QueryExpansionAgent (related questions)'
      ],
      icon: <GitBranch size={20} />,
      color: 'bg-pink-500',
      interactions: ['LLM Services', 'Retrieval Layer', 'Cache Layer']
    },
    {
      id: 'llm-services',
      name: '6. LLM Services Layer',
      description: 'Language model integration via Spark Runtime and Azure',
      components: [
        'Spark Runtime LLM API (GPT-4o/mini)',
        'Azure OpenAI Integration (optional)',
        'Prompt Engineering Templates',
        'JSON Mode Parsing',
        'Response Streaming',
        'Token Management'
      ],
      icon: <Cube size={20} />,
      color: 'bg-indigo-500',
      interactions: ['Spark Runtime', 'Agent Layer', 'Azure OpenAI']
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
      color: 'bg-yellow-500',
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
      color: 'bg-green-500',
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
      color: 'bg-amber-500',
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
      color: 'bg-teal-500',
      interactions: ['Document Store', 'Embedding Service', 'Integration APIs']
    },
    {
      id: 'document-store',
      name: '11. Document Store Layer',
      description: 'Document persistence using Spark KV store',
      components: [
        'useKV Hook (rag-documents key)',
        'Document Metadata Storage',
        'Chunk Storage & Indexing',
        'Processing Status Tracking',
        'Source Attribution',
        'Version Tracking'
      ],
      icon: <HardDrives size={20} />,
      color: 'bg-emerald-500',
      interactions: ['Spark Runtime KV', 'Document Processing', 'Vector Store']
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
      color: 'bg-sky-500',
      interactions: ['Spark KV Store', 'All Service Layers', 'Scaling Dashboard']
    },
    {
      id: 'observability',
      name: '13. Observability Layer',
      description: 'Monitoring, metrics, and workflow visualization',
      components: [
        'AgentWorkflowVisualizer',
        'ScalingDashboard (metrics)',
        'Workflow Step Tracking',
        'Performance Timing',
        'Cache Hit Rate Monitoring',
        'Error Logging (console)',
        'Quality Metrics (faithfulness, relevance)'
      ],
      icon: <Eye size={20} />,
      color: 'bg-violet-500',
      interactions: ['Orchestration Layer', 'Cache Layer', 'UI Components']
    },
    {
      id: 'infrastructure',
      name: '14. Infrastructure Layer',
      description: 'Runtime environment and external services',
      components: [
        'Spark Browser Runtime',
        'Vite Build System',
        'Azure OpenAI Services (optional)',
        'Azure AI Search (optional)',
        'GitHub API',
        'Dropbox/OneDrive APIs',
        'Browser APIs (File, Fetch, Storage)'
      ],
      icon: <Gear size={20} />,
      color: 'bg-slate-500',
      interactions: ['All Layers - Foundation']
    }
  ]

  const componentDetails: Record<string, ComponentDetail[]> = {
    'presentation': [
      {
        name: 'QueryInterface',
        purpose: 'Dual-mode chat and single-query interface with agentic workflow visualization',
        technologies: ['React 19', 'TypeScript', 'shadcn/ui', 'useKV persistence'],
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
        technologies: ['File API', 'useKV', 'shadcn Table'],
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
        name: 'Spark LLM API',
        purpose: 'Browser-based access to GPT-4o and GPT-4o-mini with JSON mode support',
        technologies: ['spark.llm()', 'spark.llmPrompt', 'Async/Await'],
        patterns: ['API Abstraction', 'Prompt Templates', 'Type Safety']
      },
      {
        name: 'Spark KV Store',
        purpose: 'Persistent browser-based key-value storage with React hooks',
        technologies: ['spark.kv API', 'useKV hook', 'Browser Storage'],
        patterns: ['Key-Value Store', 'React Hooks', 'Reactive State']
      }
    ],
    'agents': [
      {
        name: 'QueryClassifierAgent',
        purpose: 'Analyzes query complexity to determine processing strategy (simple/moderate/complex)',
        technologies: ['spark.llm()', 'JSON mode', 'Complexity scoring'],
        patterns: ['Classification Pipeline', 'Strategy Pattern', 'Confidence Scoring']
      },
      {
        name: 'QueryPlannerAgent',
        purpose: 'Decomposes complex queries into focused sub-queries for parallel retrieval',
        technologies: ['LLM-based Planning', 'Dependency Analysis'],
        patterns: ['Divide and Conquer', 'Query Decomposition', 'Parallel Execution']
      },
      {
        name: 'RoutingAgent',
        purpose: 'Selects optimal retrieval strategy (vector/keyword/hybrid) based on query characteristics',
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
        purpose: 'Validates response quality and identifies hallucinations with faithfulness scoring',
        technologies: ['spark.llm()', 'Faithfulness Analysis', 'Source Verification'],
        patterns: ['Validator Pattern', 'Quality Gates', 'Dual-Agent Verification']
      },
      {
        name: 'ReActAgent',
        purpose: 'Iteratively refines responses through Reason-Act-Observe loops',
        technologies: ['ReAct Framework', 'Multi-step Reasoning'],
        patterns: ['Iterative Refinement', 'Self-Correction', 'Thought-Action-Observation']
      },
      {
        name: 'QueryExpansionAgent',
        purpose: 'Generates 4 types of related questions (clarification/related/deeper/broader)',
        technologies: ['spark.llm()', 'Question Generation', 'Cache Integration'],
        patterns: ['Content Discovery', 'Recommendation Engine', 'Cache-Aside']
      }
    ],
    'orchestration': [
      {
        name: 'AgenticOrchestrator',
        purpose: 'Coordinates agent execution with workflow tracking and error recovery',
        technologies: ['TypeScript', 'Async/Await', 'Promise.all'],
        patterns: ['Orchestration Pattern', 'Pipeline', 'Error Handling']
      },
      {
        name: 'Workflow Step Tracking',
        purpose: 'Records each agent action with timing for visualization',
        technologies: ['Timestamp Tracking', 'Duration Calculation'],
        patterns: ['Observer Pattern', 'Event Logging', 'Timeline Generation']
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
        technologies: ['Spark KV', 'TTL Management', 'Prefix Matching', 'Cosine Similarity'],
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
    ]
  }

  const getLayerConnections = (layerId: string): string[] => {
    const layer = layers.find(l => l.id === layerId)
    return layer?.interactions || []
  }

  return (
    <div className="space-y-6">
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
                              <div className={cn("p-3 rounded-lg text-white", layer.color)}>
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
                                        Key Components
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        {layer.components.map((component, idx) => (
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
                                        Interactions
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {layer.interactions.map((interaction, idx) => (
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
                          Spark Runtime: LLM API, KV Store, User Auth
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="layers" className="space-y-4 mt-6">
              <ScrollArea className="h-[600px] pr-4">
                <div className="space-y-4">
                  {layers.map((layer) => (
                    <Card key={layer.id}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg text-white", layer.color)}>
                            {layer.icon}
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-lg">{layer.name}</CardTitle>
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
                                className="flex items-start gap-2 p-2 bg-muted/50 rounded text-xs"
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
                          <div className={cn("p-2 rounded-lg text-white", layer.color)}>
                            {layer.icon}
                          </div>
                          <h3 className="font-semibold">{layer.name}</h3>
                        </div>
                        
                        <div className="grid gap-3 ml-12">
                          {components.map((component, idx) => (
                            <Card key={idx} className="bg-muted/30">
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
                Runs entirely in the browser using Spark Runtime for LLM access and KV persistence, with optional Azure integration for production scale
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
