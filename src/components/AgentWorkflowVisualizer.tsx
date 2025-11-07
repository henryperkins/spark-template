import React, { type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Brain,
  TreeStructure,
  GitBranch,
  MagnifyingGlass,
  Sparkle,
  ShieldCheck,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  WarningCircle,
  PlayCircle,
  ChatsCircle
} from '@phosphor-icons/react'
import {
  AgentWorkflowStep,
  QueryClassification,
  QueryPlan,
  RoutingDecision,
  SubQuery,
  ValidationResult,
  ReActResult,
  ReActStep,
  QueryExpansion
} from '@/lib/agents'
import { Source } from '@/types'
import { cn } from '@/lib/utils'

interface AgentWorkflowVisualizerProps {
  steps: AgentWorkflowStep[]
  className?: string
  isLive?: boolean
}

type StatusMeta = {
  label: string
  indicatorClass: string
  connectorClass: string
  badgeClass: string
  icon: ReactNode
}

const STATUS_META: Record<AgentWorkflowStep['status'], StatusMeta> = {
  completed: {
    label: 'Completed',
    indicatorClass: 'border-status-success bg-status-success/10 text-status-success-foreground',
    connectorClass: 'bg-status-success/70',
    badgeClass: 'border-status-success text-status-success-foreground',
    icon: <CheckCircle size={14} />
  },
  running: {
    label: 'In progress',
    indicatorClass: 'border-status-processing bg-status-processing/10 text-status-processing-foreground',
    connectorClass: 'bg-status-processing/70',
    badgeClass: 'border-status-processing text-status-processing-foreground',
    icon: <PlayCircle size={14} />
  },
  failed: {
    label: 'Failed',
    indicatorClass: 'border-destructive bg-destructive/10 text-destructive',
    connectorClass: 'bg-destructive/70',
    badgeClass: 'border-destructive text-destructive',
    icon: <WarningCircle size={14} />
  },
  pending: {
    label: 'Pending',
    indicatorClass: 'border-border bg-muted text-muted-foreground',
    connectorClass: 'bg-border',
    badgeClass: 'border-border text-muted-foreground',
    icon: <Clock size={14} />
  }
}

const isPlannerStepResult = (
  value: unknown
): value is Pick<QueryPlan, 'subQueries' | 'executionStrategy'> => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { subQueries?: unknown; executionStrategy?: unknown }
  return Array.isArray(candidate.subQueries) && typeof candidate.executionStrategy === 'string'
}

const isValidationResult = (value: unknown): value is ValidationResult => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ValidationResult>
  return typeof candidate.faithfulnessScore === 'number' && typeof candidate.relevanceScore === 'number'
}

const isReActResult = (value: unknown): value is ReActResult => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ReActResult>
  return Array.isArray(candidate.steps) && typeof candidate.iterations === 'number'
}

const isExpansionResult = (value: unknown): value is QueryExpansion => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<QueryExpansion>
  return Array.isArray(candidate.suggestedQuestions)
}

const isSourceArray = (value: unknown): value is Source[] => {
  return Array.isArray(value)
}

const isErrorResult = (value: unknown): value is { error: string } => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { error?: unknown }
  return typeof candidate.error === 'string'
}

export function AgentWorkflowVisualizer({ steps, className, isLive = false }: AgentWorkflowVisualizerProps) {
  const [expandedSteps, setExpandedSteps] = React.useState<Set<number>>(new Set())
  const shouldReduceMotion = useReducedMotion()

  React.useEffect(() => {
    if (steps.length === 0) {
      setExpandedSteps(new Set())
      return
    }

    if (isLive) {
      setExpandedSteps(prev => {
        const latestIndex = steps.length - 1
        if (prev.has(latestIndex)) {
          return prev
        }
        const next = new Set(prev)
        next.add(latestIndex)
        return next
      })
    } else {
      setExpandedSteps(prev => {
        if (prev.size > 0) {
          return prev
        }
        const next = new Set<number>()
        next.add(0)
        return next
      })
    }
  }, [steps, isLive])

  const toggleStep = (index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const getAgentIcon = (agentName: string) => {
    switch (agentName.toLowerCase()) {
      case 'classifier':
        return <Brain size={16} />
      case 'planner':
        return <TreeStructure size={16} />
      case 'router':
        return <GitBranch size={16} />
      case 'retrieval':
        return <MagnifyingGlass size={16} />
      case 'generator':
        return <Sparkle size={16} />
      case 'critic':
        return <ShieldCheck size={16} />
      case 'react':
        return <ArrowsClockwise size={16} />
      default:
        return <CheckCircle size={16} />
    }
  }

  const getAgentAccent = (agentName: string) => {
    // Use brand accent scales instead of raw palettes for consistency
    // Alternate between primary and secondary accent to retain some differentiation
    switch (agentName.toLowerCase()) {
      case 'classifier':
        return 'bg-accent-3'
      case 'planner':
        return 'bg-accent-secondary-3'
      case 'router':
        return 'bg-accent-3'
      case 'retrieval':
        return 'bg-accent-secondary-3'
      case 'generator':
        return 'bg-accent-3'
      case 'critic':
        return 'bg-accent-secondary-3'
      case 'react':
        return 'bg-accent-3'
      default:
        return 'bg-muted'
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '—'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const renderHeaderSummary = (step: AgentWorkflowStep) => {
    if (!step.result || typeof step.result !== 'object') {
      return null
    }

    if (isErrorResult(step.result) && step.result.error) {
      return (
        <Badge variant="destructive" className="text-[11px]">
          Error
        </Badge>
      )
    }

    if (step.agent === 'Classifier') {
      const classification = step.result as Partial<QueryClassification>
      if (classification.complexity) {
        return (
          <Badge variant="outline" className="text-[11px] capitalize">
            {classification.complexity} • {classification.recommendedStrategy}
          </Badge>
        )
      }
    }

    if (step.agent === 'Router') {
      const routing = step.result as Partial<RoutingDecision>
      if (routing.strategy) {
        return (
          <Badge variant="outline" className="text-[11px] capitalize">
            {routing.strategy} ({Math.round((routing.confidence ?? 0) * 100)}%)
          </Badge>
        )
      }
    }

    if (step.agent === 'Retrieval' && isSourceArray(step.result)) {
      const sources = step.result as Source[]
      return (
        <span className="text-[11px] text-muted-foreground">
          {sources.length} source{sources.length !== 1 ? 's' : ''}
        </span>
      )
    }

    if (step.agent === 'ReAct') {
      const reactSummary = step.result as Partial<ReActResult>
      if (typeof reactSummary.iterations === 'number') {
        return (
          <span className="text-[11px] text-muted-foreground">
            {reactSummary.iterations} iteration{reactSummary.iterations !== 1 ? 's' : ''}
          </span>
        )
      }
    }

    if (step.agent === 'Planner' && isPlannerStepResult(step.result)) {
      return (
        <span className="text-[11px] text-muted-foreground">
          {step.result.subQueries.length} sub-queries
        </span>
      )
    }

    return null
  }

  const renderDetailContent = (step: AgentWorkflowStep) => {
    if (!step.result || typeof step.result !== 'object') {
      return null
    }

    if (isErrorResult(step.result) && step.result.error) {
      return (
        <div className="text-xs text-destructive bg-destructive/10 p-3 rounded">
          Error: {step.result.error}
        </div>
      )
    }

    if (step.agent === 'Critic' && isValidationResult(step.result)) {
      const validation = step.result
      return (
        <div className="text-xs space-y-2 leading-relaxed">
          <div className="flex gap-3">
            <span>Faithfulness: {(validation.faithfulnessScore * 100).toFixed(0)}%</span>
            <span>Relevance: {(validation.relevanceScore * 100).toFixed(0)}%</span>
            {!validation.isValid && (
              <Badge variant="destructive" className="text-xs">
                {validation.issues.length} issue{validation.issues.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {validation.issues.length > 0 && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">Issues:</div>
              <ul className="list-disc list-inside space-y-1">
                {validation.issues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.suggestions.length > 0 && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">Suggestions:</div>
              <ul className="list-disc list-inside space-y-1">
                {validation.suggestions.map((suggestion, idx) => (
                  <li key={idx}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
    }

    if (step.agent === 'Planner' && isPlannerStepResult(step.result)) {
      const { subQueries, executionStrategy } = step.result
      return (
        <div className="text-xs space-y-2">
          <div className="font-medium text-muted-foreground">
            Execution: {executionStrategy}
          </div>
          <ul className="space-y-1">
            {subQueries.map((sq: SubQuery) => (
              <li key={sq.id} className="bg-muted/60 rounded p-2.5 leading-relaxed">
                <div className="font-medium">{sq.query}</div>
                <div className="text-muted-foreground">
                  Priority {sq.priority} • {sq.purpose}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )
    }

    if (step.agent === 'ReAct' && isReActResult(step.result)) {
      const iterations = step.result.steps as ReActStep[]
      return (
        <div className="text-xs space-y-2 leading-relaxed">
          <div className="flex items-center gap-2 text-muted-foreground font-medium">
            <ChatsCircle size={14} />
            Thought → Action → Observation
          </div>
          <div className="space-y-2">
            {iterations.map((iteration, idx) => (
              <motion.div
                key={idx}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
                className="bg-muted/60 rounded p-2.5 space-y-1 leading-relaxed"
              >
                <div className="font-semibold text-muted-foreground">
                  Iteration {iteration.iteration}
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Thought: </span>
                  {iteration.thought}
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Action: </span>
                  {iteration.action}
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Observation: </span>
                  {iteration.observation}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )
    }

    if (step.agent === 'Expansion' && isExpansionResult(step.result)) {
      const expansion = step.result
      return (
        <div className="text-xs space-y-2 leading-relaxed">
          <div className="font-medium text-muted-foreground">Suggested Questions</div>
          <div className="grid gap-2 md:grid-cols-2">
            {expansion.suggestedQuestions.slice(0, 4).map((question, idx) => (
              <div key={idx} className="bg-muted/60 rounded p-2.5 leading-relaxed">
                <div className="font-medium">{question.question}</div>
                <div className="text-muted-foreground">
                  {question.category} • {(question.relevanceScore * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (step.agent === 'Retrieval' && isSourceArray(step.result)) {
      const sources = step.result as Source[]
      return (
        <div className="text-xs space-y-1 leading-relaxed">
          <div className="font-medium text-muted-foreground">
            Retrieved sources ({sources.length})
          </div>
          <ul className="space-y-1">
            {sources.slice(0, 4).map((source, idx) => (
              <li key={source.chunkId || idx} className="bg-muted/60 rounded p-2.5 leading-relaxed">
                <div className="font-medium">{source.documentName}</div>
                <div className="text-muted-foreground truncate">
                  {source.content?.slice(0, 120)}{source.content?.length > 120 ? '…' : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )
    }

    return null
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Brain size={18} className="text-primary" />
          <h4 className="font-semibold text-sm">Agent Workflow</h4>
          <Badge variant="outline" className="ml-auto text-xs">
            {steps.length} step{steps.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {steps.length === 0 ? (
          <div className="text-xs text-muted-foreground">Workflow updates will appear here.</div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {steps.map((step, index) => {
                const isExpanded = expandedSteps.has(index)
                const statusMeta = STATUS_META[step.status] ?? STATUS_META.pending
                const detailContent = renderDetailContent(step)
                const hasDetails = Boolean(detailContent)

                return (
                  <motion.div
                    key={`${step.agent}-${index}-${step.status}-${step.timestamp}`}
                    layout={!shouldReduceMotion}
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                    animate={shouldReduceMotion ? false : { opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: -10 }}
                    transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
                    className="relative"
                  >
                    {index < steps.length - 1 && (
                      <motion.div
                        layout={!shouldReduceMotion}
                        initial={shouldReduceMotion ? false : { opacity: 0, scaleY: 0 }}
                        animate={shouldReduceMotion ? false : { opacity: 1, scaleY: 1 }}
                        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
                        className={cn(
                          'absolute left-[13px] top-9 bottom-0 w-[2px] origin-top rounded-full',
                          statusMeta.connectorClass
                        )}
                      />
                    )}

                    <div className="flex gap-3">
                      <div
                        className={cn(
                          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border-2 relative z-10 bg-background',
                          statusMeta.indicatorClass
                        )}
                        aria-label={`${statusMeta.label} step`}
                      >
                        <span className={cn('absolute inset-0 rounded-full', getAgentAccent(step.agent))} />
                        <span className="relative z-10">
                          {getAgentIcon(step.agent)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Badge variant="secondary" className="text-xs flex-shrink-0">
                              {step.agent}
                            </Badge>
                            <span className="text-sm text-muted-foreground truncate">
                              {step.action}
                            </span>
                            {renderHeaderSummary(step)}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant="outline" className={cn('text-[11px]', statusMeta.badgeClass)}>
                              <span className="flex items-center gap-1">
                                {statusMeta.icon}
                                {statusMeta.label}
                              </span>
                            </Badge>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock size={12} />
                              {formatDuration(step.duration)}
                            </div>
                            {hasDetails && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => toggleStep(index)}
                              >
                                {isExpanded ? 'Hide details' : 'View details'}
                              </Button>
                            )}
                          </div>
                        </div>

                        <AnimatePresence initial={false}>
                          {hasDetails && isExpanded && (
                            <motion.div
                              initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                              animate={shouldReduceMotion ? false : { opacity: 1, height: 'auto' }}
                              exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
                              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
                              className="mt-2 bg-muted/60 p-3 rounded"
                            >
                              {detailContent}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
