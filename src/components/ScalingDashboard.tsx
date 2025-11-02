import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Bell
} from '@phosphor-icons/react'
import { Document } from '@/types'
import { embeddingManager } from '@/lib/embedding-manager'
import { cacheManager } from '@/lib/cache-manager'
import { tokenTracker } from '@/lib/services/token-tracker'
import { errorTracking } from '@/lib/services/error-tracker'
import { AlertPanel } from './AlertPanel'
import { toast } from 'sonner'

interface ScalingDashboardProps {
  documents: Document[]
}

export function ScalingDashboard({ documents }: ScalingDashboardProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState({ current: 0, total: 0, documentName: '' })
  const [refreshMetrics, setRefreshMetrics] = useState<any>(null)
  const [cacheMetrics, setCacheMetrics] = useState<any>(null)
  const [lastRefreshResult, setLastRefreshResult] = useState<any>(null)
  const [tokenMetrics, setTokenMetrics] = useState<any>(null)
  const [errorMetrics, setErrorMetrics] = useState<any>(null)

  useEffect(() => {
    loadMetrics()

    // Refresh metrics every 5 seconds for real-time updates
    const interval = setInterval(loadMetrics, 5000)
    return () => clearInterval(interval)
  }, [documents])

  const loadMetrics = async () => {
    try {
      const [refresh, cache] = await Promise.all([
        embeddingManager.getRefreshMetrics(),
        cacheManager.getMetrics()
      ])
      setRefreshMetrics(refresh)
      setCacheMetrics(cache)

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

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatDays = (days: number) => {
    if (days < 1) return `${(days * 24).toFixed(1)}h`
    return `${days.toFixed(1)}d`
  }

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
        <TabsList className="grid w-full grid-cols-5 max-w-3xl">
          <TabsTrigger value="embeddings">
            <Database size={16} className="mr-2" />
            Embeddings
          </TabsTrigger>
          <TabsTrigger value="cache">
            <Lightning size={16} className="mr-2" />
            Cache
          </TabsTrigger>
          <TabsTrigger value="costs">
            <CurrencyDollar size={16} className="mr-2" />
            Costs
          </TabsTrigger>
          <TabsTrigger value="errors">
            <WarningCircle size={16} className="mr-2" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <ChartBar size={16} className="mr-2" />
            Metrics
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
              <div className="flex gap-3">
                <Button
                  onClick={handleIncrementalRefresh}
                  disabled={refreshing || documents.length === 0}
                  className="flex-1"
                >
                  <ArrowsClockwise size={16} className="mr-2" />
                  Incremental Refresh
                </Button>
                <Button
                  onClick={handleFullRefresh}
                  disabled={refreshing || documents.length === 0}
                  variant="secondary"
                  className="flex-1"
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
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Total Documents</div>
                    <div className="text-2xl font-bold">{refreshMetrics.totalDocuments}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Needing Refresh</div>
                    <div className="text-2xl font-bold text-orange-600">
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
                    <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
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
                <div className="grid grid-cols-3 gap-2">
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-red-600 mr-1">●</span> High: 1 day
                  </Badge>
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-orange-600 mr-1">●</span> Medium: 7 days
                  </Badge>
                  <Badge variant="outline" className="justify-center py-2">
                    <span className="text-green-600 mr-1">●</span> Low: 30 days
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Total Cached</div>
                      <div className="text-2xl font-bold">{cacheMetrics.totalKeys}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Hit Rate</div>
                      <div className="text-2xl font-bold text-green-600">
                        {(cacheMetrics.hitRate * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Stale Entries</div>
                      <div className="text-2xl font-bold text-orange-600">
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
                          {cacheMetrics.recentInvalidations.slice(0, 5).map((event: any, idx: number) => (
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
                <div className="grid grid-cols-2 gap-2 text-xs">
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

        <TabsContent value="metrics" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>System Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                          {volatility === 'high' && <Warning size={16} className="text-red-600" />}
                          {volatility === 'medium' && <Clock size={16} className="text-orange-600" />}
                          {volatility === 'low' && <CheckCircle size={16} className="text-green-600" />}
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
              {tokenMetrics && (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Today's Tokens</div>
                      <div className="text-2xl font-bold">
                        {tokenMetrics.daily.tokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Today's Cost</div>
                      <div className="text-2xl font-bold text-green-600">
                        ${tokenMetrics.daily.cost.toFixed(3)}
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
                    <div className="grid grid-cols-2 gap-2 text-sm">
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
                      {Object.entries(tokenMetrics.byModel).map(([model, stats]: [string, any]) => (
                        <div key={model} className="p-3 bg-muted rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">{model}</span>
                            <Badge variant="outline">{stats.count} requests</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
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
              </CardTitle>
              <CardDescription>
                Monitor system errors and failure rates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMetrics && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">Error Rate (last hour)</div>
                      <div className="text-2xl font-bold text-red-600">
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
                          {errorMetrics.recentErrors.map((error: any) => (
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
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>System Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                          {volatility === 'high' && <Warning size={16} className="text-red-600" />}
                          {volatility === 'medium' && <Clock size={16} className="text-orange-600" />}
                          {volatility === 'low' && <CheckCircle size={16} className="text-green-600" />}
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
      </Tabs>
    </div>
  )
}
