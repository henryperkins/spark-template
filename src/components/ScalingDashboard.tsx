import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  ArrowsClockwise,
  Database,
  Lightning,
  ChartBar,
  CheckCircle,
  Warning,
  Clock,
  Trash,
  CurrencyDollar,
  WarningCircle,
  Bug,
  CopySimple,
  Download
} from '@phosphor-icons/react'
import { Document } from '@/types'
import { embeddingManager, type RefreshResult } from '@/lib/embedding-manager'
import { cacheManager, type CacheMetrics, type CacheInvalidationEvent } from '@/lib/cache-manager'
import { tokenTracker, type ModelStats } from '@/lib/services/token-tracker'
import { errorTracking, type ErrorMetrics, type ErrorEvent } from '@/lib/services/error-tracker'
import { AlertPanel } from './AlertPanel'
import { SearchDebugger } from './SearchDebugger'
import { toast } from 'sonner'
import { queryHistoryService, type QueryHistoryEntry } from '@/lib/services/query-history'
import { useStorage } from '@/hooks/use-kv'

interface ScalingDashboardProps {
  documents: Document[]
}

type RefreshMetrics = Awaited<ReturnType<typeof embeddingManager.getRefreshMetrics>>

type TokenDashboardMetrics = {
  daily: ReturnType<typeof tokenTracker.getDailyUsage>
  budget: Awaited<ReturnType<typeof tokenTracker.getBudgetStatus>>
  byModel: ReturnType<typeof tokenTracker.getMetricsByModel>
}

export function ScalingDashboard({ documents }: ScalingDashboardProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState({ current: 0, total: 0, documentName: '' })
  const [refreshMetrics, setRefreshMetrics] = useState<RefreshMetrics | null>(null)
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetrics | null>(null)
  const [lastRefreshResult, setLastRefreshResult] = useState<RefreshResult | null>(null)
  const [tokenMetrics, setTokenMetrics] = useState<TokenDashboardMetrics | null>(null)
  const [errorMetrics, setErrorMetrics] = useState<ErrorMetrics | null>(null)
  const [recentHistory, setRecentHistory] = useState<QueryHistoryEntry[]>([])
  const [activeNamespace, setActiveNamespace] = useStorage<string>('active-namespace', '')
  const documentsWithErrors = useMemo(
    () =>
      documents.filter((document) => {
        const hasProcessingError = document.processingStatus === 'error'
        const hasErrorMessage = typeof document.errorMessage === 'string' && document.errorMessage.trim().length > 0
        return hasProcessingError || hasErrorMessage
      }),
    [documents]
  )

  useEffect(() => {
    loadMetrics()

    // Refresh metrics every 5 seconds for real-time updates
    const interval = setInterval(loadMetrics, 5000)
    return () => clearInterval(interval)
  }, [documents])

  const loadMetrics = async () => {
    try {
      const [refresh, cache, history] = await Promise.all([
        embeddingManager.getRefreshMetrics(),
        cacheManager.getMetrics(),
        queryHistoryService.getRecent(25)
      ])
      setRefreshMetrics(refresh)
      setCacheMetrics(cache)
      setRecentHistory(history)

      // Get token metrics (some async for Spark KV)
      const dailyUsage = tokenTracker.getDailyUsage()
      const budgetStatus = await tokenTracker.getBudgetStatus()
      const byModel = tokenTracker.getMetricsByModel()

      setTokenMetrics({
        daily: dailyUsage,
        budget: budgetStatus,
        byModel
      })

      // Get error metrics (synchronous)
      setErrorMetrics(errorTracking.getMetrics())
    } catch (error) {
      console.error('Failed to load metrics:', error)
    }
  }

  const handleIncrementalRefresh = async () => {
    setRefreshing(true)
    setRefreshProgress({ current: 0, total: documents.length, documentName: '' })

    try {
      const result = await embeddingManager.performIncrementalRefresh(
        documents,
        (progress) => setRefreshProgress(progress)
      )

      setLastRefreshResult(result)
      await loadMetrics()

      toast.success('Incremental Refresh Complete', {
        description: `Refreshed ${result.refreshedCount}, skipped ${result.skippedCount} (${(result.duration / 1000).toFixed(2)}s)`
      })
    } catch (error) {
      toast.error('Refresh failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setRefreshing(false)
      setRefreshProgress({ current: 0, total: 0, documentName: '' })
    }
  }

  const handleFullRefresh = async () => {
    setRefreshing(true)
    setRefreshProgress({ current: 0, total: documents.length, documentName: '' })

    try {
      const result = await embeddingManager.performFullRefresh(
        documents,
        (progress) => setRefreshProgress(progress)
      )

      setLastRefreshResult(result)
      await loadMetrics()

      toast.success('Full Refresh Complete', {
        description: `All ${result.refreshedCount} documents refreshed (${(result.duration / 1000).toFixed(2)}s)`
      })
    } catch (error) {
      toast.error('Refresh failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setRefreshing(false)
      setRefreshProgress({ current: 0, total: 0, documentName: '' })
    }
  }

  const handleCleanCache = async () => {
    setCleaning(true)

    try {
      const cleaned = await cacheManager.cleanStaleEntries()
      await loadMetrics()

      toast.success('Cache Cleaned', {
        description: `Removed ${cleaned} stale entries`
      })
    } catch (error) {
      toast.error('Cache cleanup failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setCleaning(false)
    }
  }

  const handleExportMetrics = () => {
    if (!tokenMetrics || !errorMetrics) return

    const exportData = {
      timestamp: new Date().toISOString(),
      tokenMetrics: {
        daily: tokenMetrics.daily,
        budget: tokenMetrics.budget,
        byModel: tokenMetrics.byModel
      },
      errorMetrics: {
        errorRate: errorMetrics.errorRate,
        totalErrors: errorMetrics.totalErrors,
        byType: errorMetrics.byType,
        errorsByAgent: errorMetrics.errorsByAgent,
        recentErrors: errorMetrics.recentErrors
      },
      cacheMetrics: cacheMetrics,
      refreshMetrics: refreshMetrics
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rag-metrics-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Metrics exported successfully')
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatDays = (days: number) => {
    if (days < 1) return `${(days * 24).toFixed(1)}h`
    return `${days.toFixed(1)}d`
  }

  const formatUploadDate = (uploadedAt?: string) => {
    if (!uploadedAt) return 'Unknown'
    const parsed = new Date(uploadedAt)
    return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString()
  }

  const tabTriggerClass = 'text-xs sm:text-sm min-h-[2.75rem] flex-shrink-0 basis-[140px] px-3 sm:basis-auto sm:w-full whitespace-nowrap'

  // Derived telemetry analytics from recent history
  const telemetryAvailable = recentHistory.some(h => !!h.executionSummary || (h.workflow && h.workflow.length > 0))
  const averagePhaseDurations = useMemo(() => {
    const accum: Record<string, { sum: number; count: number }> = {}
    const push = (phase: string, value: number) => {
      if (!Number.isFinite(value) || value <= 0) return
      const k = phase
      const slot = accum[k] || { sum: 0, count: 0 }
      slot.sum += value
      slot.count += 1
      accum[k] = slot
    }
    for (const h of recentHistory) {
      if (h.executionSummary?.phaseBreakdown) {
        for (const [phase, ms] of Object.entries(h.executionSummary.phaseBreakdown)) {
          push(phase, ms)
        }
      } else if (h.workflow && h.workflow.length > 0) {
        // Infer from workflow agents
        const map: Record<string, string> = {
          'Classifier': 'classification',
          'Planner': 'planning',
          'Router': 'routing',
          'Retrieval': 'retrieval',
          'Generator': 'generation',
          'Critic': 'validation',
          'ReAct': 'refinement',
          'Expansion': 'expansion'
        }
        for (const step of h.workflow) {
          const phase = map[step.agent]
          if (phase) push(phase, step.duration || 0)
        }
      }
    }
    const out: Record<string, number> = {}
    for (const [phase, { sum, count }] of Object.entries(accum)) {
      out[phase] = count > 0 ? Math.round(sum / count) : 0
    }
    return out
  }, [recentHistory])

  const averageBudgetUtilization = useMemo(() => {
    const entries = recentHistory.filter(h => !!h.executionSummary)
    if (entries.length === 0) return { tokens: 0, time: 0 }
    const tokens = entries.reduce((s, h) => s + (h.executionSummary?.budgetUtilization.tokens || 0), 0) / entries.length
    const time = entries.reduce((s, h) => s + (h.executionSummary?.budgetUtilization.time || 0), 0) / entries.length
    return { tokens, time }
  }, [recentHistory])

  const recentRuns = useMemo(() => recentHistory.slice(0, 5), [recentHistory])
  const retrievalMetrics = useMemo(() => {
    const entries = recentHistory
    if (entries.length === 0) {
      return { avgScore: 0, avgLatency: 0, degradedRate: 0 }
    }
    const withScore = entries.filter(e => typeof e.retrievalAvgScore === 'number')
    const avgScore = withScore.length > 0
      ? withScore.reduce((s, e) => s + (e.retrievalAvgScore || 0), 0) / withScore.length
      : 0
    const withLatency = entries.filter(e => typeof e.retrievalDuration === 'number')
    const avgLatency = withLatency.length > 0
      ? withLatency.reduce((s, e) => s + (e.retrievalDuration || 0), 0) / withLatency.length
      : 0
    const degradedRate = entries.reduce((s, e) => s + (e.azureFallback ? 1 : 0), 0) / entries.length
    return { avgScore, avgLatency, degradedRate }
  }, [recentHistory])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Scaling & Performance</h2>
        <p className="text-muted-foreground">
          Monitor and manage embedding refresh and cache invalidation strategies
        </p>
      </div>

      {/* Alert Panel at the top */}
      <AlertPanel />

      <Tabs defaultValue="embeddings" className="space-y-6">
        <TabsList className="flex w-full gap-2 overflow-x-auto pb-1 px-1 sm:grid sm:grid-cols-3 xl:grid-cols-6 sm:overflow-visible sm:p-[3px]">
          <TabsTrigger value="embeddings" className={tabTriggerClass}>
            <Database size={16} className="mr-2" />
            Embeddings
          </TabsTrigger>
          <TabsTrigger value="cache" className={tabTriggerClass}>
            <Lightning size={16} className="mr-2" />
            Cache
          </TabsTrigger>
          <TabsTrigger value="costs" className={tabTriggerClass}>
            <CurrencyDollar size={16} className="mr-2" />
            Costs
          </TabsTrigger>
          <TabsTrigger value="errors" className={tabTriggerClass}>
            <WarningCircle size={16} className="mr-2" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="metrics" className={tabTriggerClass}>
            <ChartBar size={16} className="mr-2" />
            Metrics
          </TabsTrigger>
          <TabsTrigger value="telemetry" className={tabTriggerClass}>
            <ChartBar size={16} className="mr-2" />
            Telemetry
          </TabsTrigger>
          <TabsTrigger value="debug" className={tabTriggerClass}>
            <Bug size={16} className="mr-2" />
            Search Debug
          </TabsTrigger>
        </TabsList>

        <TabsContent value="embeddings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowsClockwise size={20} />
                Embedding Refresh
              </CardTitle>
              <CardDescription>
                Incremental updates detect changes via checksums. Full refresh recomputes all embeddings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button
                  onClick={handleIncrementalRefresh}
                  disabled={refreshing || documents.length === 0}
                  className="w-full sm:flex-1"
                >
                  <ArrowsClockwise size={16} className="mr-2" />
                  Incremental Refresh
                </Button>
                <Button
                  onClick={handleFullRefresh}
                  disabled={refreshing || documents.length === 0}
                  variant="secondary"
                  className="w-full sm:flex-1"
                >
                  <Database size={16} className="mr-2" />
                  Full Refresh
                </Button>
              </div>

              {refreshing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Processing: {refreshProgress.documentName || 'Starting...'}
                    </span>
                    <span className="font-medium">
                      {refreshProgress.current} / {refreshProgress.total}
                    </span>
                  </div>
                  <Progress
                    value={refreshProgress.total > 0 ? (refreshProgress.current / refreshProgress.total) * 100 : 0}
                  />
                </div>
              )}

              {refreshMetrics && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Total Documents</div>
                    <div className="text-2xl font-bold">{refreshMetrics.totalDocuments}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Needing Refresh</div>
                    <div className="text-2xl font-bold text-status-warning">
                      {refreshMetrics.needingRefresh}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Avg. Age</div>
                    <div className="text-lg font-medium">
                      {formatDays(refreshMetrics.averageDaysSinceRefresh)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Versions</div>
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(refreshMetrics.byVersion).map(([version, count]) => (
                        <Badge key={version} variant="outline">
                          {version}: {count as number}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {lastRefreshResult && (
                <Alert>
                  <CheckCircle size={16} />
                  <AlertTitle>Last Refresh Result</AlertTitle>
                  <AlertDescription>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-sm">
                      <div>Refreshed: <strong>{lastRefreshResult.refreshedCount}</strong></div>
                      <div>Skipped: <strong>{lastRefreshResult.skippedCount}</strong></div>
                      <div>Duration: <strong>{formatDuration(lastRefreshResult.duration)}</strong></div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              <div className="space-y-2">
                <h4 className="font-medium text-sm">Volatility-Based Refresh Intervals</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-status-error mr-1">●</span> High: 1 day
                  </Badge>
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-status-warning mr-1">●</span> Medium: 7 days
                  </Badge>
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-status-success mr-1">●</span> Low: 30 days
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cache" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightning size={20} />
                Cache Management
              </CardTitle>
              <CardDescription>
                Tiered TTL with event-driven and prefix-based invalidation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleCleanCache}
                disabled={cleaning}
                variant="outline"
                className="w-full"
              >
                <Trash size={16} className="mr-2" />
                Clean Stale Entries
              </Button>

              {cacheMetrics && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Total Cached</div>
                      <div className="text-2xl font-bold">{cacheMetrics.totalKeys}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Hit Rate</div>
                      <div className="text-2xl font-bold text-status-success">
                        {(cacheMetrics.hitRate * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Stale Entries</div>
                      <div className="text-2xl font-bold text-status-warning">
                        {cacheMetrics.staleEntries}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Avg. Age</div>
                      <div className="text-lg font-medium">
                        {(cacheMetrics.averageAge / 60).toFixed(1)} min
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">TTL Distribution</h4>
                    <div className="space-y-1">
                      {Object.entries(cacheMetrics.byTTL).map(([category, count]) => (
                        <div key={category} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{category}</span>
                          <Badge variant="secondary">{count as number}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  {cacheMetrics.recentInvalidations.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">Recent Invalidations</h4>
                        <div className="space-y-2">
                          {cacheMetrics.recentInvalidations.slice(0, 5).map((event: CacheInvalidationEvent, idx: number) => (
                            <div key={idx} className="p-2 bg-muted rounded-md text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <Badge variant="outline" className="text-xs">
                                  {event.type}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {new Date(event.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-muted-foreground">{event.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              <Separator />

              <div className="space-y-2">
                <h4 className="font-medium text-sm">Cache Strategies</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-muted rounded">
                    <div className="font-medium mb-1">TTL-Based</div>
                    <div className="text-muted-foreground">Tiered expiration by content type</div>
                  </div>
                  <div className="p-2 bg-muted rounded">
                    <div className="font-medium mb-1">Event-Driven</div>
                    <div className="text-muted-foreground">Invalidate on document changes</div>
                  </div>
                  <div className="p-2 bg-muted rounded">
                    <div className="font-medium mb-1">Prefix-Based</div>
                    <div className="text-muted-foreground">Bulk clear by document ID</div>
                  </div>
                  <div className="p-2 bg-muted rounded">
                    <div className="font-medium mb-1">Version-Based</div>
                    <div className="text-muted-foreground">Auto-invalidate on version change</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CurrencyDollar size={20} />
                Token Usage & Costs
              </CardTitle>
              <CardDescription>
                Monitor LLM token consumption and estimated costs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={handleExportMetrics} variant="outline" size="sm">
                  <Download size={16} className="mr-2" />
                  Export Metrics
                </Button>
              </div>
              {tokenMetrics && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Today's Tokens</div>
                      <div className="text-2xl font-bold">
                        {tokenMetrics.daily.totalTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Today's Cost</div>
                      <div className="text-2xl font-bold text-status-success">
                        ${tokenMetrics.daily.totalCost.toFixed(3)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Queries Today</div>
                      <div className="text-2xl font-bold">
                        {tokenMetrics.daily.queryCount}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">Daily Budget Status</h4>
                      <Badge variant={tokenMetrics.budget.isOverLimit ? 'destructive' : tokenMetrics.budget.isNearLimit ? 'secondary' : 'default'}>
                        {tokenMetrics.budget.percentageUsed.toFixed(1)}% used
                      </Badge>
                    </div>
                    <Progress value={tokenMetrics.budget.percentageUsed} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div className="text-muted-foreground">
                        Limit: {tokenMetrics.budget.dailyLimit.toLocaleString()} tokens
                      </div>
                      <div className="text-muted-foreground text-right">
                        Remaining: {tokenMetrics.budget.remainingTokens.toLocaleString()} tokens
                      </div>
                    </div>
                  </div>

                  {tokenMetrics.budget.isNearLimit && (
                    <Alert>
                      <Warning size={16} />
                      <AlertTitle>Approaching Budget Limit</AlertTitle>
                      <AlertDescription>
                        You've used {tokenMetrics.budget.percentageUsed.toFixed(1)}% of your daily token budget.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Usage by Model</h4>
                    <div className="space-y-2">
                      {Object.entries(tokenMetrics.byModel).map(([model, stats]: [string, ModelStats]) => (
                        <div key={model} className="p-3 bg-muted rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">{model}</span>
                            <Badge variant="outline">{stats.count} requests</Badge>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="text-muted-foreground">
                              {stats.totalTokens.toLocaleString()} tokens
                            </div>
                            <div className="text-muted-foreground text-right">
                              ${stats.totalCost.toFixed(3)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WarningCircle size={20} />
                Error Tracking
                {documentsWithErrors.length > 0 && (
                  <Badge variant="destructive" className="ml-auto">
                    {documentsWithErrors.length} doc issue{documentsWithErrors.length === 1 ? '' : 's'}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Monitor system errors and failure rates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMetrics ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Error Rate (last hour)</div>
                      <div className="text-2xl font-bold text-status-error">
                        {errorMetrics.errorRate}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Total Errors</div>
                      <div className="text-2xl font-bold">
                        {errorMetrics.totalErrors}
                      </div>
                    </div>
                  </div>

                  {errorMetrics.errorRate > 5 && (
                    <Alert variant="destructive">
                      <WarningCircle size={16} />
                      <AlertTitle>High Error Rate</AlertTitle>
                      <AlertDescription>
                        Error rate is above normal threshold. Check recent errors below.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Error Types</h4>
                    <div className="space-y-1">
                      {Object.entries(errorMetrics.byType).map(([type, count]) => {
                        const errorCount = count as number
                        return errorCount > 0 ? (
                          <div key={type} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                            <span className="capitalize">{type}</span>
                            <Badge variant="destructive">{errorCount}</Badge>
                          </div>
                        ) : null
                      })}
                    </div>
                  </div>

                  {Object.keys(errorMetrics.errorsByAgent).length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">Errors by Agent</h4>
                        <div className="space-y-1">
                          {Object.entries(errorMetrics.errorsByAgent).map(([agent, count]) => (
                            <div key={agent} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                              <span>{agent}</span>
                              <Badge variant="outline">{count as number}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {errorMetrics.recentErrors.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">Recent Errors</h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {errorMetrics.recentErrors.map((error: ErrorEvent) => (
                            <div key={error.errorId} className="p-3 bg-destructive/10 rounded-lg text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">{error.type}</Badge>
                                  {error.agent && <Badge variant="secondary" className="text-xs">{error.agent}</Badge>}
                                </div>
                                <span className="text-muted-foreground">
                                  {new Date(error.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-destructive font-medium mb-1">{error.message}</p>
                              {error.code && (
                                <p className="text-muted-foreground">Code: {error.code}</p>
                              )}
                              {typeof error.status === 'number' && (
                                <p className="text-muted-foreground">HTTP: {error.status}</p>
                              )}
                              {error.requestId && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span>requestId:</span>
                                  <Badge variant="outline" className="font-mono break-all">
                                    {error.requestId}
                                  </Badge>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label="Copy requestId"
                                    className="h-6 w-6"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard?.writeText(error.requestId as string)
                                        toast.success('requestId copied')
                                      } catch {
                                        // Ignore clipboard write failures
                                      }
                                    }}
                                  >
                                    <CopySimple size={14} />
                                  </Button>
                                </div>
                              )}
                              <div className="mt-1 flex flex-wrap items-center gap-3">
                                <a
                                  href="https://status.azure.com/en-us/status"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline underline-offset-4"
                                >
                                  Check Azure Status →
                                </a>
                                <a href="#azure-configuration" className="text-primary underline underline-offset-4">
                                  Open Azure configuration
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No runtime error metrics available.
                </p>
              )}

              <div className="space-y-2">
                <h4 className="font-medium text-sm">Knowledge Base Documents</h4>
                {documentsWithErrors.length > 0 ? (
                  <div className="space-y-2">
                    {documentsWithErrors.map((document) => (
                      <div key={document.id} className="p-3 bg-destructive/10 rounded-lg text-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-destructive">{document.name}</span>
                          <Badge variant="outline" className="uppercase">
                            {document.processingStatus || 'unknown'}
                          </Badge>
                        </div>
                        {document.errorMessage ? (
                          <p className="text-destructive">{document.errorMessage}</p>
                        ) : (
                          <p className="text-muted-foreground">
                            Document is marked as errored but no message was captured.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 text-muted-foreground">
                          {document.source && (
                            <Badge variant="secondary" className="text-[10px]">
                              Source: {document.source}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px]">
                            {document.chunks.length} chunk{document.chunks.length === 1 ? '' : 's'}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            Uploaded {formatUploadDate(document.uploadedAt)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-muted rounded-lg text-xs text-muted-foreground">
                    All knowledge base documents are healthy.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Retrieval Metrics</span>
              </CardTitle>
              <CardDescription>Recent runs: average relevance (0–1), latency, degraded rate</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Avg. Relevance</div>
                <div className="text-2xl font-bold">{retrievalMetrics.avgScore.toFixed(3)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Avg. Retrieval Latency</div>
                <div className="text-2xl font-bold">{formatDuration(retrievalMetrics.avgLatency)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Degraded Rate</div>
                <div className="text-2xl font-bold text-status-warning">{(retrievalMetrics.degradedRate * 100).toFixed(1)}%</div>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>System Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Documents</div>
                    <div className="text-2xl font-bold">{documents.length}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Total Chunks</div>
                    <div className="text-2xl font-bold">
                      {documents.reduce((acc, doc) => acc + doc.chunks.length, 0)}
                    </div>
                  </div>
                  {refreshMetrics && (
                    <>
                      <div className="space-y-1">
                        <div className="text-sm text-muted-foreground">Embedding Version</div>
                        <Badge variant="outline" className="mt-1">v2025.01</Badge>
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm text-muted-foreground">Cache Version</div>
                        <Badge variant="outline" className="mt-1">v2025.01</Badge>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {refreshMetrics && (
              <Card>
                <CardHeader>
                  <CardTitle>Volatility Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(refreshMetrics.byVolatility).map(([volatility, count]) => (
                      <div key={volatility} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {volatility === 'high' && <Warning size={16} className="text-status-error" />}
                          {volatility === 'medium' && <Clock size={16} className="text-status-warning" />}
                          {volatility === 'low' && <CheckCircle size={16} className="text-status-success" />}
                          <span className="capitalize">{volatility}</span>
                        </div>
                        <Badge>{count as number} docs</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="telemetry" className="space-y-4">
          {!telemetryAvailable ? (
            <Card>
              <CardHeader>
                <CardTitle>Agent Telemetry</CardTitle>
                <CardDescription>Run some queries to populate telemetry.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Phase Averages (last {recentHistory.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.keys(averagePhaseDurations).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No phase timing available.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {Object.entries(averagePhaseDurations).map(([phase, ms]) => (
                        <div key={phase} className="p-2 bg-muted rounded text-xs flex items-center justify-between">
                          <span className="capitalize">{phase}</span>
                          <Badge variant="outline">{formatDuration(ms)}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Budget Utilization</CardTitle>
                  <CardDescription>Average utilization across recent runs</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Token Budget</div>
                    <Progress value={Math.min(100, averageBudgetUtilization.tokens * 100)} />
                    <div className="text-xs text-muted-foreground">
                      {(averageBudgetUtilization.tokens * 100).toFixed(1)}% average used
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Time Budget</div>
                    <Progress value={Math.min(100, averageBudgetUtilization.time * 100)} />
                    <div className="text-xs text-muted-foreground">
                      {(averageBudgetUtilization.time * 100).toFixed(1)}% average used
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Runs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {recentRuns.map(run => (
                    <div key={run.id} className="p-2 bg-muted rounded text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{run.query}</div>
                        <div className="flex items-center gap-2">
                          {run.azureFallback && <Badge variant="destructive">fallback</Badge>}
                          <Badge variant="outline">{formatDuration(run.totalDuration)}</Badge>
                        </div>
                      </div>
                      {run.executionSummary ? (
                        <div className="flex gap-3 mt-1 text-muted-foreground">
                          <div>tokens: <strong>{run.executionSummary.totalTokens}</strong></div>
                          <div>cost: <strong>${run.executionSummary.totalCost.toFixed(3)}</strong></div>
                          <div>calls: <strong>{run.executionSummary.llmCallCount}</strong></div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground mt-1">
                          No token/cost summary available.
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="debug" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Namespace</span>
              </CardTitle>
              <CardDescription>Scope retrieval to a namespace (local and Azure)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="active-namespace">Active Namespace</Label>
              <Input
                id="active-namespace"
                placeholder="e.g., team-a-prod"
                value={activeNamespace || ''}
                onChange={(e) => setActiveNamespace(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to query across all locally loaded chunks. If Azure config sets a namespace, both will apply.
              </p>
            </CardContent>
          </Card>
          <SearchDebugger documents={documents} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
