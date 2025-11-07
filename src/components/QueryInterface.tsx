import { useState } from 'react'
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
    } catch {
      const errorMessage: ExtendedChatMessage = {
        id: `msg-${Date.now()}-error`,
        type: 'assistant',
        content: "I apologize, but I encountered an error while processing your question. Please try again.",
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
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
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Brain size={20} />
              Ask Your Knowledge Base
            </CardTitle>
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
            <p className="text-sm text-muted-foreground mt-3">
              Upload documents first to start asking questions
            </p>
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
            <Card
              key={message.id}
              className={cn(
                "max-w-full",
                message.type === 'user' ? 'sm:ml-10' : 'sm:mr-10'
              )}
            >
              <CardContent className="space-y-4 p-4 sm:p-5">
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
                
                <div className="prose prose-sm max-w-none">
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </p>
                </div>

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
                              <div key={source.chunkId} className="p-3 bg-muted rounded-lg">
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
                                <p className="text-sm font-mono leading-relaxed">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
