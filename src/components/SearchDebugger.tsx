import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { MagnifyingGlass, Flask, Database, Sparkle, ClockCounterClockwise, Trash, CaretDown, CaretRight, FileMagnifyingGlass, CloudArrowUp } from '@phosphor-icons/react'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { RoutingAgent } from '@/lib/agents/routing-agent'
import { AzureConfig, Document } from '@/types'
import { findRelevantChunksWithMeta } from '@/lib/rag'
import { queryHistoryService, QueryHistoryEntry } from '@/lib/services/query-history'
import { toast } from 'sonner'
import { useStorage } from '@/hooks/use-kv'

interface SearchDebuggerProps {
  documents: Document[]
}

export function SearchDebugger({ documents }: SearchDebuggerProps) {
  // Analyzer Testing State
  const [analyzerText, setAnalyzerText] = useState('')
  const [selectedAnalyzer, setSelectedAnalyzer] = useState('en.microsoft')
  const [analyzerResult, setAnalyzerResult] = useState<Array<{ token: string; position: number }> | null>(null)
  const [analyzerLoading, setAnalyzerLoading] = useState(false)

  // Query Explainer State
  const [explainQuery, setExplainQuery] = useState('')
  const [explainResult, setExplainResult] = useState<{
    routing: { strategy: string; reasoning: string; confidence: number }
    sources: Array<{ documentName: string; chunkId: string; content: string; relevanceScore: number }>
    metadata?: { avgRelevanceScore: number; degraded: boolean; duration: number }
  } | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)

  // Index Stats State
  const [indexStats, setIndexStats] = useState<{ documentCount: number; storageSize: number } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // Query History State
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([])
  const [historyStats, setHistoryStats] = useState<{ total: number; avgDuration: number; azureFallbackRate: number; strategyDistribution: Record<string, number> } | null>(null)
  const [strategyFilter, setStrategyFilter] = useState<string>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Chunk Browser State
  const [selectedDocId, setSelectedDocId] = useState<string>('')
  const [chunkSearch, setChunkSearch] = useState('')
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null)

  // Load query history on mount
  useEffect(() => {
    loadQueryHistory()
  }, [])

  const availableAnalyzers = [
    'en.microsoft',
    'en.lucene',
    'standard.lucene',
    'keyword',
    'whitespace',
    'pattern'
  ]

  const handleTestAnalyzer = async () => {
    if (!analyzerText.trim()) {
      toast.error('Please enter text to analyze')
      return
    }

    if (!azureServiceManager.isConfigured()) {
      toast.error('Azure AI Search is not configured')
      return
    }

    setAnalyzerLoading(true)
    try {
      const searchService = azureServiceManager.getSearchService()
      if (!searchService) {
        throw new Error('Search service not available')
      }

      const result = await searchService.testAnalyzer(analyzerText, selectedAnalyzer)

      if (result.error) {
        toast.error('Analyzer test failed', { description: result.error })
        setAnalyzerResult(null)
      } else {
        setAnalyzerResult(result.tokens.map(t => ({ token: t.token, position: t.position })))
        toast.success('Analysis complete', { description: `Found ${result.tokens.length} tokens` })
      }
    } catch (error) {
      toast.error('Analyzer test failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
      setAnalyzerResult(null)
    } finally {
      setAnalyzerLoading(false)
    }
  }

  const handleExplainQuery = async () => {
    if (!explainQuery.trim()) {
      toast.error('Please enter a query to explain')
      return
    }

    setExplainLoading(true)
    try {
      const routingAgent = new RoutingAgent()
      // Build KB context for routing (can pass undefined if not available)
      const routing = await routingAgent.selectStrategy(explainQuery, undefined)

      const { sources, metadata } = await findRelevantChunksWithMeta(
        explainQuery,
        documents,
        5,
        routing.strategy,
        { namespaceId: (activeNamespace || azureConfig?.search?.namespace) || undefined }
      )

      setExplainResult({
        routing: {
          strategy: routing.strategy,
          reasoning: routing.reasoning,
          confidence: routing.confidence
        },
        sources: sources.map(s => ({
          documentName: s.documentName,
          chunkId: s.chunkId,
          content: s.content.substring(0, 200) + (s.content.length > 200 ? '...' : ''),
          relevanceScore: s.relevanceScore
        })),
        metadata: {
          avgRelevanceScore: metadata.avgRelevanceScore,
          degraded: metadata.degraded,
          duration: metadata.duration
        }
      })

      toast.success('Query explained', {
        description: `Strategy: ${routing.strategy}${metadata.degraded ? ' (degraded)' : ''}`
      })
    } catch (error) {
      toast.error('Query explanation failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
      setExplainResult(null)
    } finally {
      setExplainLoading(false)
    }
  }

  const handleLoadIndexStats = async () => {
    if (!azureServiceManager.isConfigured()) {
      toast.error('Azure AI Search is not configured')
      return
    }

    setStatsLoading(true)
    try {
      const searchService = azureServiceManager.getSearchService()
      if (!searchService) {
        throw new Error('Search service not available')
      }

      const result = await searchService.getIndexStats()

      if (result.error) {
        toast.error('Failed to load index stats', { description: result.error })
        setIndexStats(null)
      } else {
        setIndexStats({
          documentCount: result.documentCount,
          storageSize: result.storageSize
        })
        toast.success('Index stats loaded')
      }
    } catch (error) {
      toast.error('Failed to load index stats', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
      setIndexStats(null)
    } finally {
      setStatsLoading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const loadQueryHistory = async () => {
    setHistoryLoading(true)
    try {
      const [history, stats] = await Promise.all([
        queryHistoryService.getAll(),
        queryHistoryService.getStats()
      ])
      setQueryHistory(history)
      setHistoryStats(stats)
    } catch (error) {
      console.error('Failed to load query history:', error)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleClearHistory = async () => {
    try {
      await queryHistoryService.clear()
      setQueryHistory([])
      setHistoryStats(null)
      toast.success('Query history cleared')
    } catch (error) {
      toast.error('Failed to clear history', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const filteredHistory = queryHistory.filter(entry => {
    // Filter by strategy
    if (strategyFilter !== 'all' && entry.routing.strategy !== strategyFilter) {
      return false
    }
    // Filter by search term
    if (historySearch && !entry.query.toLowerCase().includes(historySearch.toLowerCase())) {
      return false
    }
    return true
  })

  // Chunk Browser Logic
  const selectedDoc = documents.find(doc => doc.id === selectedDocId)
  const chunksWithEmbeddings = selectedDoc?.chunks.filter(c => c.embedding || c.azureEmbedding).length || 0
  const avgChunkLength = selectedDoc ? Math.round(selectedDoc.chunks.reduce((sum, c) => sum + c.content.length, 0) / selectedDoc.chunks.length) : 0

  const filteredChunks = selectedDoc?.chunks.filter(chunk => {
    if (chunkSearch && !chunk.content.toLowerCase().includes(chunkSearch.toLowerCase())) {
      return false
    }
    return true
  }) || []

  return (
    <div className="space-y-6">
      {/* Analyzer Testing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flask size={20} />
            Analyzer Testing
          </CardTitle>
          <CardDescription>
            Test how text is tokenized by different analyzers to debug search matching issues
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!azureServiceManager.isConfigured() && (
            <Alert>
              <AlertDescription>
                Azure AI Search must be configured to use analyzer testing. Configure it in the Azure tab.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Select Analyzer</label>
            <Select value={selectedAnalyzer} onValueChange={setSelectedAnalyzer}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableAnalyzers.map(analyzer => (
                  <SelectItem key={analyzer} value={analyzer}>
                    {analyzer}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Text to Analyze</label>
            <Textarea
              placeholder="Enter text to see how it's tokenized..."
              value={analyzerText}
              onChange={(e) => setAnalyzerText(e.target.value)}
              rows={3}
            />
          </div>

          <Button
            onClick={handleTestAnalyzer}
            disabled={analyzerLoading || !azureServiceManager.isConfigured()}
            className="w-full"
          >
            <Flask size={16} className="mr-2" />
            Test Analyzer
          </Button>

          {analyzerResult && (
            <div className="space-y-2">
              <Separator />
              <h4 className="font-medium text-sm">Tokens ({analyzerResult.length})</h4>
              <div className="flex flex-wrap gap-2">
                {analyzerResult.map((token, idx) => (
                  <Badge key={idx} variant="secondary" className="font-mono">
                    {token.token}
                    <span className="ml-1 text-xs text-muted-foreground">#{token.position}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Query Explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MagnifyingGlass size={20} />
            Query Explainer
          </CardTitle>
          <CardDescription>
            See how queries are routed and which results are retrieved with scores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Query</label>
            <Input
              placeholder="Enter a query to explain..."
              value={explainQuery}
              onChange={(e) => setExplainQuery(e.target.value)}
            />
          </div>

          <Button
            onClick={handleExplainQuery}
            disabled={explainLoading || documents.length === 0}
            className="w-full"
          >
            <Sparkle size={16} className="mr-2" />
            Explain Query
          </Button>

          {explainResult && (
            <div className="space-y-4">
              <Separator />

              <div className="space-y-2">
                <h4 className="font-medium text-sm">Routing Decision</h4>
                <div className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Strategy</span>
                    <div className="flex items-center gap-2">
                      <Badge>{explainResult.routing.strategy}</Badge>
                      {explainResult.metadata?.degraded && (
                        <Badge variant="destructive">Degraded</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Confidence</span>
                    <Badge variant="outline">
                      {(explainResult.routing.confidence * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {explainResult.metadata && (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Avg. Score</span>
                        <span className="font-mono">{explainResult.metadata.avgRelevanceScore.toFixed(3)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Latency</span>
                        <span className="font-mono">{formatDuration(explainResult.metadata.duration)}</span>
                      </div>
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {explainResult.routing.reasoning}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-sm">Retrieved Results ({explainResult.sources.length})</h4>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {explainResult.sources.map((source, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{source.documentName}</span>
                        <Badge variant="secondary">
                          Score: {source.relevanceScore.toFixed(3)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{source.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Index Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={20} />
            Index Statistics
          </CardTitle>
          <CardDescription>
            View Azure AI Search index statistics and storage information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!azureServiceManager.isConfigured() && (
            <Alert>
              <AlertDescription>
                Azure AI Search must be configured to view index statistics. Configure it in the Azure tab.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleLoadIndexStats}
            disabled={statsLoading || !azureServiceManager.isConfigured()}
            className="w-full"
          >
            <Database size={16} className="mr-2" />
            Load Index Stats
          </Button>

          {indexStats && (
            <div className="space-y-2">
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Documents Indexed</div>
                  <div className="text-2xl font-bold">{indexStats.documentCount.toLocaleString()}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Storage Size</div>
                  <div className="text-2xl font-bold">{formatBytes(indexStats.storageSize)}</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Query History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockCounterClockwise size={20} />
            Query History
          </CardTitle>
          <CardDescription>
            Track past queries with routing decisions, performance metrics, and validation scores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            <Select value={strategyFilter} onValueChange={setStrategyFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All strategies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Strategies</SelectItem>
                <SelectItem value="vector">Vector</SelectItem>
                <SelectItem value="keyword">Keyword</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Search history..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />

            <Button variant="outline" onClick={handleClearHistory} disabled={queryHistory.length === 0}>
              <Trash size={16} />
            </Button>
          </div>

          {/* Summary Stats */}
          {historyStats && historyStats.total > 0 && (
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold">{historyStats.total}</div>
                <div className="text-xs text-muted-foreground">Total Queries</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {formatDuration(historyStats.avgDuration)}
                </div>
                <div className="text-xs text-muted-foreground">Avg Duration</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {(historyStats.azureFallbackRate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground">Fallback Rate</div>
              </div>
            </div>
          )}

          {/* History List */}
          {historyLoading ? (
            <div className="text-center text-muted-foreground py-8">Loading history...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {queryHistory.length === 0 ? 'No query history yet. Try running some queries!' : 'No queries match your filters.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80"
                  onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {expandedEntry === entry.id ? <CaretDown size={16} /> : <CaretRight size={16} />}
                      <span className="font-medium text-sm truncate">{entry.query}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={
                        entry.routing.strategy === 'hybrid' ? 'default' :
                        entry.routing.strategy === 'vector' ? 'secondary' : 'outline'
                      }>
                        {entry.routing.strategy}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(entry.totalDuration)}
                      </span>
                    </div>
                  </div>

                  {/* Expandable Details */}
                  {expandedEntry === entry.id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground">Results:</span> {entry.resultCount}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Top Score:</span> {entry.topScore.toFixed(3)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Confidence:</span> {(entry.routing.confidence * 100).toFixed(0)}%
                        </div>
                        <div>
                          <span className="text-muted-foreground">Fallback:</span> {entry.azureFallback ? 'Yes' : 'No'}
                        </div>
                      </div>

                      {entry.complexity && (
                        <div>
                          <span className="text-muted-foreground">Complexity:</span>{' '}
                          <Badge variant="outline" className="text-xs">
                            {entry.complexity}
                          </Badge>
                        </div>
                      )}

                      <div className="text-muted-foreground italic">
                        {entry.routing.reasoning}
                      </div>

                      {entry.validation && (
                        <div className="pt-2 space-y-1">
                          <div className="font-medium">Validation Scores:</div>
                          <div className="grid grid-cols-2 gap-2 pl-2">
                            <div>
                              <span className="text-muted-foreground">Faithfulness:</span>{' '}
                              <Badge variant={entry.validation.faithfulnessScore >= 0.7 ? 'default' : 'destructive'}>
                                {(entry.validation.faithfulnessScore * 100).toFixed(0)}%
                              </Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Relevance:</span>{' '}
                              <Badge variant={entry.validation.relevanceScore >= 0.7 ? 'default' : 'destructive'}>
                                {(entry.validation.relevanceScore * 100).toFixed(0)}%
                              </Badge>
                            </div>
                          </div>
                        </div>
                      )}

                      {entry.workflow && entry.workflow.length > 0 && (
                        <div className="pt-2">
                          <div className="font-medium mb-1">Workflow ({entry.workflow.length} steps):</div>
                          <div className="space-y-1 pl-2">
                            {entry.workflow.map((step, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span className="text-muted-foreground">
                                  {step.agent}: {step.action.length > 40 ? step.action.substring(0, 40) + '...' : step.action}
                                </span>
                                <Badge variant={step.status === 'completed' ? 'default' : step.status === 'failed' ? 'destructive' : 'outline'} className="text-xs">
                                  {formatDuration(step.duration)}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chunk Browser */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileMagnifyingGlass size={20} />
            Chunk Browser
          </CardTitle>
          <CardDescription>
            Inspect document chunks, embeddings, and content quality
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {documents.length === 0 ? (
            <Alert>
              <AlertDescription>
                No documents available. Upload documents to inspect their chunks.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Document Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Document</label>
                <Select value={selectedDocId} onValueChange={setSelectedDocId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a document..." />
                  </SelectTrigger>
                  <SelectContent>
                    {documents.map(doc => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.name} ({doc.chunks.length} chunks)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedDoc && (
                <>
                  {/* Document Info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted rounded-lg">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Total Chunks</div>
                      <div className="text-2xl font-bold">{selectedDoc.chunks.length}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Azure Indexed</div>
                      <div className="text-2xl font-bold">
                        {selectedDoc.azureIndexed ? '✓' : '✗'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">With Embeddings</div>
                      <div className="text-2xl font-bold text-green-11">
                        {chunksWithEmbeddings} / {selectedDoc.chunks.length}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Avg Length</div>
                      <div className="text-2xl font-bold">
                        {avgChunkLength} chars
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Chunk Search */}
                  <Input
                    placeholder="Search within chunks..."
                    value={chunkSearch}
                    onChange={(e) => setChunkSearch(e.target.value)}
                  />

                  {/* Chunk List */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredChunks.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        {chunkSearch ? 'No chunks match your search.' : 'No chunks in this document.'}
                      </div>
                    ) : (
                      filteredChunks.map((chunk) => (
                        <div
                          key={chunk.id}
                          className="p-3 border border-border rounded-lg cursor-pointer hover:border-accent-9"
                          onClick={() => setExpandedChunk(expandedChunk === chunk.id ? null : chunk.id)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">Chunk {chunk.chunkIndex}</Badge>
                              {chunk.embedding && (
                                <Badge variant="secondary" className="text-xs">
                                  <Sparkle size={12} className="mr-1" />
                                  Local
                                </Badge>
                              )}
                              {chunk.azureEmbedding && (
                                <Badge variant="default" className="text-xs">
                                  <CloudArrowUp size={12} className="mr-1" />
                                  Azure
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {chunk.content.length} chars
                            </span>
                          </div>

                          {/* Chunk Preview */}
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {chunk.content}
                          </p>

                          {/* Expanded View */}
                          {expandedChunk === chunk.id && (
                            <div className="mt-3 pt-3 border-t border-border space-y-3">
                              {/* Full Content */}
                              <div className="space-y-1">
                                <div className="text-xs font-medium">Full Content:</div>
                                <div className="p-3 bg-muted rounded text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
                                  {chunk.content}
                                </div>
                              </div>

                              {/* Embedding Info */}
                              {(chunk.embedding || chunk.azureEmbedding) && (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">Embedding Info:</div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                    {chunk.embedding && (
                                      <div className="p-2 bg-muted rounded">
                                        <div className="font-medium mb-1">Local Embedding</div>
                                        <div className="text-muted-foreground">
                                          Dimensions: {chunk.embedding.length}
                                        </div>
                                        <div className="text-muted-foreground font-mono text-xs">
                                          [{chunk.embedding.slice(0, 3).map(v => v.toFixed(3)).join(', ')}...]
                                        </div>
                                      </div>
                                    )}
                                    {chunk.azureEmbedding && (
                                      <div className="p-2 bg-muted rounded">
                                        <div className="font-medium mb-1">Azure Embedding</div>
                                        <div className="text-muted-foreground">
                                          Dimensions: {chunk.azureEmbedding.length}
                                        </div>
                                        <div className="text-muted-foreground font-mono text-xs">
                                          [{chunk.azureEmbedding.slice(0, 3).map(v => v.toFixed(3)).join(', ')}...]
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Metadata */}
                              {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">Metadata:</div>
                                  <div className="p-2 bg-muted rounded text-xs">
                                    <pre className="whitespace-pre-wrap">{JSON.stringify(chunk.metadata, null, 2)}</pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
  const [azureConfig] = useStorage<AzureConfig | null>('azure-config', null)
  const [activeNamespace] = useStorage<string>('active-namespace', '')
