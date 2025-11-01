import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  Brain, 
  TreeStructure, 
  GitBranch, 
  MagnifyingGlass, 
  Sparkle,
  ShieldCheck,
  ArrowsClockwise,
  CheckCircle,
  Clock
} from '@phosphor-icons/react'
import { AgentWorkflowStep } from '@/lib/agents'
import { cn } from '@/lib/utils'

interface AgentWorkflowVisualizerProps {
  steps: AgentWorkflowStep[]
  className?: string
}

export function AgentWorkflowVisualizer({ steps, className }: AgentWorkflowVisualizerProps) {
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

  const getAgentColor = (agentName: string) => {
    switch (agentName.toLowerCase()) {
      case 'classifier':
        return 'text-blue-500'
      case 'planner':
        return 'text-purple-500'
      case 'router':
        return 'text-green-500'
      case 'retrieval':
        return 'text-yellow-600'
      case 'generator':
        return 'text-pink-500'
      case 'critic':
        return 'text-red-500'
      case 'react':
        return 'text-indigo-500'
      default:
        return 'text-gray-500'
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '—'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
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

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={`${step.agent}-${index}`} className="relative">
              {index < steps.length - 1 && (
                <div className="absolute left-[11px] top-8 bottom-0 w-[2px] bg-border" />
              )}
              
              <div className="flex gap-3">
                <div className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-background border-2 border-border relative z-10",
                  getAgentColor(step.agent)
                )}>
                  {getAgentIcon(step.agent)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        {step.agent}
                      </Badge>
                      <span className="text-sm text-muted-foreground truncate">
                        {step.action}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      <Clock size={12} />
                      {formatDuration(step.duration)}
                    </div>
                  </div>

                  {step.result && typeof step.result === 'object' && !step.result.error && (
                    <div className="text-xs bg-muted p-2 rounded mt-1">
                      {step.agent === 'Classifier' && step.result.complexity && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {step.result.complexity}
                          </Badge>
                          <span className="text-muted-foreground">
                            → {step.result.recommendedStrategy}
                          </span>
                        </div>
                      )}
                      {step.agent === 'Router' && step.result.strategy && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {step.result.strategy}
                          </Badge>
                          <span className="text-muted-foreground">
                            {(step.result.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                      )}
                      {step.agent === 'Planner' && step.result.subQueries && (
                        <div>
                          {step.result.subQueries.length} sub-queries ({step.result.executionStrategy})
                        </div>
                      )}
                      {step.agent === 'Retrieval' && Array.isArray(step.result) && (
                        <div>
                          Retrieved {step.result.length} source{step.result.length !== 1 ? 's' : ''}
                        </div>
                      )}
                      {step.agent === 'Critic' && step.result.faithfulnessScore !== undefined && (
                        <div className="flex gap-3">
                          <span>Faithfulness: {(step.result.faithfulnessScore * 100).toFixed(0)}%</span>
                          <span>Relevance: {(step.result.relevanceScore * 100).toFixed(0)}%</span>
                          {!step.result.isValid && (
                            <Badge variant="destructive" className="text-xs">
                              {step.result.issues.length} issue{step.result.issues.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                      )}
                      {step.agent === 'ReAct' && step.result.iterations !== undefined && (
                        <div>
                          {step.result.iterations} iteration{step.result.iterations !== 1 ? 's' : ''} 
                          {step.result.improved && ' ✓ improved'}
                        </div>
                      )}
                    </div>
                  )}

                  {step.result?.error && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded mt-1">
                      Error: {step.result.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
