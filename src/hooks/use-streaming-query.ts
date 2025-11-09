import { useState, useCallback, useRef } from 'react'
import { Document, Source } from '@/types'
import { AgenticRAGResult, AgentWorkflowStep } from '@/lib/agents'
import { AgenticOrchestrator } from '@/lib/agents/orchestrator'
import { AgentStepEvent } from '@/lib/services/telemetry'
import { llmService } from '@/lib/services/llm-service'
import { findRelevantChunks } from '@/lib/rag'
import { errorTracking } from '@/lib/services/error-tracker'

export interface StreamingMessage {
  id: string
  content: string
  isStreaming: boolean
  type: 'user' | 'assistant'
  timestamp: string
  sources?: Source[]
  azureUsed?: boolean
  agenticResult?: AgenticRAGResult
  azureFallback?: boolean
}

interface UseStreamingQueryOptions {
  agenticMode: boolean
  documents: Document[]
  orchestrator?: AgenticOrchestrator
  onWorkflowUpdate?: (steps: AgentWorkflowStep[]) => void
}

export function useStreamingQuery(options: UseStreamingQueryOptions) {
  const { agenticMode, documents, orchestrator, onWorkflowUpdate } = options
  const [messages, setMessages] = useState<StreamingMessage[]>([])
  const [loading, setLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const executeStreamingQuery = useCallback(async (query: string) => {
    if (loading) return
    if (!query.trim()) return

    setLoading(true)

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController()

    // Add user message immediately
    const userMessage: StreamingMessage = {
      id: `user-${Date.now()}`,
      content: query,
      isStreaming: false,
      type: 'user',
      timestamp: new Date().toISOString()
    }

    // Add streaming assistant message placeholder
    const assistantMessage: StreamingMessage = {
      id: `assistant-${Date.now()}`,
      content: '',
      isStreaming: true,
      type: 'assistant',
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])

    try {
      let sources: Source[] = []
      let agenticResult: AgenticRAGResult | undefined
      let azureFallbackDetected = false
      const startTime = Date.now()

      if (agenticMode && orchestrator) {
        // Agentic mode: Use orchestrator (which handles its own workflow)
        const runId = userMessage.id
        agenticResult = await orchestrator.processQuery(query, documents, {
          runId,
          onWorkflowUpdate,
          onStepEvent: (event: AgentStepEvent) => {
            if (event.status === 'failed') {
              console.error('[agent-step failed]', event)
            } else if (import.meta.env?.MODE !== 'production') {
              console.debug('[agent-step]', event.agent, event.action, event.status)
            }
          }
        })

        if (agenticResult) {
          sources = agenticResult.sources
          azureFallbackDetected = agenticResult.azureFallback

          // For agentic mode, stream the final response
          if (agenticResult.response) {
            // Simulate streaming the response by chunking it
            await streamTextInChunks(
              agenticResult.response,
              assistantMessage.id,
              setMessages,
              abortControllerRef.current.signal
            )
          }
        }

        // Update final message with all metadata
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: agenticResult?.response || 'No response generated.',
                isStreaming: false,
                sources: sources.length > 0 ? sources : undefined,
                azureUsed: sources.some(s => s.azureScore !== undefined),
                agenticResult,
                azureFallback: azureFallbackDetected
              }
            : msg
        ))

      } else {
        // Non-agentic mode: Use direct RAG with streaming
        sources = await findRelevantChunks(query, documents, 5, 'hybrid', {
          onAzureFallback: () => {
            azureFallbackDetected = true
          }
        })

        // Build context from sources
        const context = sources.map(s => s.content).join('\n\n')
        const prompt = `Based on the following context, answer the question concisely and accurately.

Context:
${context}

Question: ${query}

Answer:`

        let accumulatedContent = ''

        // Stream the response
        try {
          const stream = llmService.generateTextStream(prompt, {
            maxTokens: 1000,
            temperature: 0.7
          })

          for await (const chunk of stream) {
            if (abortControllerRef.current?.signal.aborted) {
              break
            }

            accumulatedContent += chunk

            // Update message with streaming content
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessage.id
                ? { ...msg, content: accumulatedContent }
                : msg
            ))

            // Small delay for smooth visual streaming
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        } catch (streamError) {
          console.warn('[streaming] Stream failed, using fallback:', streamError)
          // Fallback to non-streaming if stream fails
          const fallbackResponse = await llmService.generateText(prompt, {
            maxTokens: 1000,
            temperature: 0.7
          })
          accumulatedContent = fallbackResponse
        }

        // Mark as complete with final metadata
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: accumulatedContent,
                isStreaming: false,
                sources: sources.length > 0 ? sources : undefined,
                azureUsed: sources.some(s => s.azureScore !== undefined),
                azureFallback: azureFallbackDetected
              }
            : msg
        ))

        // Log query to history (non-agentic)
        const totalDuration = Date.now() - startTime
        const { queryHistoryService } = await import('@/lib/services/query-history')
        const { azureServiceManager } = await import('@/lib/azure-service-manager')

        queryHistoryService.add({
          id: userMessage.id,
          timestamp: new Date().toISOString(),
          query,
          routing: {
            strategy: 'hybrid',
            reasoning: 'Non-agentic mode with streaming: default hybrid search',
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

    } catch (error) {
      // Handle errors
      errorTracking.record(error as Error, {
        type: 'llm',
        agent: 'streaming-query',
        code: 'stream_error'
      })

      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessage.id
          ? {
              ...msg,
              content: 'Sorry, there was an error processing your query. Please try again.',
              isStreaming: false
            }
          : msg
      ))

      console.error('[streaming-query error]', error)
    } finally {
      setLoading(false)
      abortControllerRef.current = null
    }
  }, [loading, agenticMode, documents, orchestrator, onWorkflowUpdate])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setLoading(false)
    }
  }, [])

  return {
    messages,
    loading,
    executeStreamingQuery,
    clearMessages,
    cancelStreaming
  }
}

/**
 * Helper function to stream text in chunks with delays for visual effect
 */
async function streamTextInChunks(
  text: string,
  messageId: string,
  setMessages: React.Dispatch<React.SetStateAction<StreamingMessage[]>>,
  signal: AbortSignal
): Promise<void> {
  const chunkSize = 10 // Characters per chunk
  const delayMs = 20 // Delay between chunks

  let position = 0

  while (position < text.length) {
    if (signal.aborted) break

    position += chunkSize
    const chunk = text.slice(0, position)

    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, content: chunk }
        : msg
    ))

    if (position < text.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}
