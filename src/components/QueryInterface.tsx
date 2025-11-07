import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { MagnifyingGlass, Brain, FileText, Link, Sparkle, CloudSlash } from '@phosphor-icons/react'
import { Document, ChatMessage, Source } from '@/types'
import { findRelevantChunks, generateResponse } from '@/lib/rag'
import { AgenticOrchestrator, AgenticRAGResult, AgentWorkflowStep } from '@/lib/agents'
import { AgentWorkflowVisualizer } from './AgentWorkflowVisualizer'
import { SuggestedQuestions } from './SuggestedQuestions'
import { queryHistoryService } from '@/lib/services/query-history'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cn } from '@/lib/utils'

interface QueryInterfaceProps {
  documents: Document[]
}

interface ExtendedChatMessage extends ChatMessage {
  agenticResult?: AgenticRAGResult
  azureFallback?: boolean
}

export function QueryInterface({ documents }: QueryInterfaceProps) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<ExtendedChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [agenticMode, setAgenticMode] = useState(true)
  const [orchestrator] = useState(() => new AgenticOrchestrator())
  const [activeWorkflow, setActiveWorkflow] = useState<AgentWorkflowStep[]>([])
  const [recentQueries, setRecentQueries] = useState<string[]>([])

  useEffect(() => {
    let isMounted = true
    ;(async () => {
      try {
        const history = await queryHistoryService.getAll()
        if (!isMounted || !history || history.length === 0) return
        const unique = Array.from(
          new Map(
            history
              .slice(-10)
              .reverse()
              .map(entry => [entry.query.trim(), entry.query.trim()])
          ).values()
        ).filter(q => q.length > 0)
        setRecentQueries(unique.slice(0, 3))
      } catch (error) {
        console.error('[recent-queries] failed to load history', error)
      }
    })()
    return () => {
      isMounted = false
    }
  }, [])
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || loading) return

    await executeQuery(query)
  }

  const executeQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return

    const userMessage: ExtendedChatMessage = {
      id: `msg-${Date.now()}-user`,
      type: 'user',
      content: queryText,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setLoading(true)
    setQuery('')
    if (agenticMode) {
      setActiveWorkflow([])
    }

    try {
      let sources: Source[]
      let response: string
      let agenticResult: AgenticRAGResult | undefined
      let azureFallbackDetected = false
      const startTime = Date.now()

      if (agenticMode) {
        const runId = userMessage.id
        agenticResult = await orchestrator.processQuery(queryText, documents, {
          runId,
          onWorkflowUpdate: (steps) => {
            setActiveWorkflow(steps)
          },
          onStepEvent: (event) => {
            if (event.status === 'failed') {
              console.error('[agent-step failed]', event)
            } else if (import.meta.env?.MODE !== 'production') {
              console.debug('[agent-step]', event.agent, event.action, event.status)
            }
          }
        })
        sources = agenticResult.sources
        response = agenticResult.response
        azureFallbackDetected = agenticResult.azureFallback
        // Agentic queries are logged by AgenticOrchestrator
      } else {
        // Non-agentic query: log manually
        sources = await findRelevantChunks(queryText, documents, 5, 'hybrid', {
          onAzureFallback: () => {
            azureFallbackDetected = true
          }
        })
        response = await generateResponse(queryText, sources)

        const totalDuration = Date.now() - startTime

        // Log non-agentic query to history
        queryHistoryService.add({
          id: userMessage.id,
          timestamp: new Date().toISOString(),
          query: queryText,
          routing: {
            strategy: 'hybrid',
            reasoning: 'Non-agentic mode: default hybrid search',
            confidence: 1.0
          },
          resultCount: sources.length,
          topScore: sources[0]?.relevanceScore || 0,
          azureUsed: azureServiceManager.isConfigured(),
          azureFallback: azureFallbackDetected,
          totalDuration
        }).catch(error => {
          console.error('Failed to log query to history:', error)
        })
      }

      const assistantMessage: ExtendedChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        type: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined,
        azureUsed: sources.some(s => s.azureScore !== undefined),
        agenticResult,
        azureFallback: azureFallbackDetected
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (err) {
      const errorId = `msg-${Date.now()}-error`
      const errorMessage: ExtendedChatMessage = {
        id: errorId,
        type: 'assistant',
        content:
          'Something went wrong while processing your question. Please review the details below and try again.',
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])

      // Log to console for debugging without exposing internals to end users
      console.error('[query-error]', err)
    } finally {
      setLoading(false)
      setTimeout(() => {
        setActiveWorkflow([])
      }, 300)
    }
  }

  const handleSuggestedQuestionSelect = (question: string) => {
    executeQuery(question)
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Brain size={20} />
                Ask Your Knowledge Base
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Ask questions against your ingested documents. Switch Agentic Mode on for routed, validated answers.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="agentic-mode" className="cursor-pointer text-sm">
                Agentic Mode
              </Label>
              <Switch
                id="agentic-mode"
                checked={agenticMode}
                onCheckedChange={setAgenticMode}
              />
              {agenticMode && (
                <Badge variant="secondary" className="ml-2">
                  <Sparkle size={12} className="mr-1" />
                  Enhanced
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {messages.length === 0 && recentQueries.length > 0 && (
            <div className="mb-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Recent questions
              </p>
              <div className="flex flex-wrap gap-2">
                {recentQueries.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => executeQuery(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your documents..."
              disabled={loading || documents.length === 0}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !query.trim() || documents.length === 0}
              className="w-full sm:w-auto"
            >
              {loading ? (
                <div className="animate-spin w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full" />
              ) : (
                <MagnifyingGlass size={16} />
              )}
            </Button>
          </form>
          
          {documents.length === 0 && (
            <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="text-sm font-medium text-foreground mb-1">
                Add content to unlock high-quality answers
              </p>
              <p className="text-xs text-muted-foreground">
                Use the <span className="font-medium">Upload</span> tab for single files or <span className="font-medium">Integrations</span> tab to connect GitHub, websites, Dropbox, or OneDrive.
              </p>
            </div>
          )}

          {agenticMode && (
            <p className="text-xs text-muted-foreground mt-3">
              Agentic mode uses query classification, planning, routing, and validation for enhanced accuracy
            </p>
          )}
        </CardContent>
      </Card>

      {messages.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Conversation</h3>

          {agenticMode && loading && activeWorkflow.length > 0 && (
            <AgentWorkflowVisualizer
              steps={activeWorkflow}
              className="border border-primary/30 shadow-sm"
              isLive
            />
          )}
          
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-full rounded-lg p-4 sm:p-5 space-y-4",
                message.type === 'user'
                  ? 'sm:ml-10 border border-border/60 bg-background'
                  : 'sm:mr-10 bg-muted/40'
              )}
            >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Badge variant={message.type === 'user' ? 'default' : 'secondary'}>
                    {message.type === 'user' ? 'You' : 'Assistant'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(message.timestamp)}
                  </span>
                </div>

                {message.type === 'assistant' && message.azureFallback && (
                  <Alert variant="warning" className="mb-3">
                    <AlertTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <CloudSlash size={16} />
                      Using Local Search
                    </AlertTitle>
                    <AlertDescription className="space-y-3 text-sm sm:text-base">
                      <p>
                        Azure AI Search is temporarily unavailable. Results are from local vector search and may be less comprehensive.
                      </p>
                      <span className="inline-flex">
                        <a
                          href="https://status.azure.com/en-us/status"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded px-0 text-sm font-medium text-primary underline underline-offset-4 sm:text-base"
                        >
                          Check Azure Status →
                        </a>
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
                
                {message.id.includes('-error') ? (
                  <Alert variant="destructive">
                    <AlertTitle className="text-sm font-semibold">
                      Query failed
                    </AlertTitle>
                    <AlertDescription className="text-xs sm:text-sm space-y-1">
                      <p>{message.content}</p>
                      <p>
                        • Verify your{' '}
                        <a
                          href="#azure-configuration"
                          className="text-primary underline underline-offset-4"
                        >
                          Azure configuration
                        </a>{' '}
                        is correct.
                      </p>
                      <p>
                        • Ensure you've ingested content via the{' '}
                        <span className="font-medium">Upload</span> or{' '}
                        <span className="font-medium">Integrations</span> tabs.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 px-2 text-[10px]"
                        onClick={() =>
                          executeQuery(
                            messages[messages.length - 2]?.content || query || ''
                          )
                        }
                      >
                        Try again
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                )}

                {message.agenticResult && (
                  <div className="mt-4">
                    <AgentWorkflowVisualizer steps={message.agenticResult.workflow} />
                    
                    {message.agenticResult.validation && (
                      <div className="mt-3 p-3 bg-muted rounded-lg">
                        <div className="text-xs font-medium mb-2">Quality Metrics</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Faithfulness:</span>{' '}
                            <Badge variant="outline" className="text-xs ml-1">
                              {(message.agenticResult.validation.faithfulnessScore * 100).toFixed(0)}%
                            </Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Relevance:</span>{' '}
                            <Badge variant="outline" className="text-xs ml-1">
                              {(message.agenticResult.validation.relevanceScore * 100).toFixed(0)}%
                            </Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total Time:</span>{' '}
                            <Badge variant="outline" className="text-xs ml-1">
                              {(message.agenticResult.totalDuration / 1000).toFixed(2)}s
                            </Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Complexity:</span>{' '}
                            <Badge variant="outline" className="text-xs ml-1">
                              {message.agenticResult.classification.complexity}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {message.agenticResult?.expansion && message.agenticResult.expansion.suggestedQuestions.length > 0 && (
                  <div className="mt-4">
                    <SuggestedQuestions
                      expansion={message.agenticResult.expansion}
                      onQuestionSelect={handleSuggestedQuestionSelect}
                      loading={loading}
                    />
                  </div>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <Accordion type="single" collapsible>
                      <AccordionItem value="sources" className="border-none">
                        <AccordionTrigger className="text-sm text-muted-foreground hover:no-underline py-2">
                          <div className="flex items-center gap-2">
                            <Link size={14} />
                            Sources ({message.sources.length})
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 mt-2">
                            {message.sources.map((source, index) => (
                              <div key={source.chunkId} className="p-3 bg-muted/30 rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      [{index + 1}]
                                    </Badge>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <FileText size={12} />
                                      {source.documentName}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    {Math.round(source.relevanceScore * 100)}% match
                                  </Badge>
                                </div>
                                <p className="text-sm leading-relaxed">
                                  {source.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
