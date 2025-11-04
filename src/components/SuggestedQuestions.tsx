import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QueryExpansion } from '@/lib/agents/query-expansion'
import { Sparkle, Question, Lightbulb, TreeStructure, ArrowsOutSimple, Lightning } from '@phosphor-icons/react'

interface SuggestedQuestionsProps {
  expansion: QueryExpansion
  onQuestionSelect: (question: string) => void
  loading?: boolean
}

export function SuggestedQuestions({ expansion, onQuestionSelect, loading = false }: SuggestedQuestionsProps) {
  const { suggestedQuestions, cached } = expansion

  if (suggestedQuestions.length === 0) {
    return null
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'clarification':
        return <Question size={14} weight="duotone" />
      case 'related':
        return <TreeStructure size={14} weight="duotone" />
      case 'deeper':
        return <Lightbulb size={14} weight="duotone" />
      case 'broader':
        return <ArrowsOutSimple size={14} weight="duotone" />
      default:
        return <Sparkle size={14} weight="duotone" />
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'clarification':
        return 'bg-blue-2 text-blue-11 border-blue-9'
      case 'related':
        return 'bg-purple-2 text-purple-11 border-purple-9'
      case 'deeper':
        return 'bg-green-2 text-green-11 border-green-9'
      case 'broader':
        return 'bg-orange-2 text-orange-11 border-orange-9'
      default:
        return 'bg-neutral-2 text-neutral-11 border-neutral-9'
    }
  }

  const sortedQuestions = [...suggestedQuestions].sort((a, b) => b.relevanceScore - a.relevanceScore)

  return (
    <Card className="bg-secondary/30 border-primary/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkle size={18} className="text-primary" weight="duotone" />
            Related Questions You Might Ask
          </CardTitle>
          {cached && (
            <Badge variant="outline" className="text-xs flex items-center gap-1">
              <Lightning size={12} />
              Cached
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedQuestions.map((sq, index) => (
          <Button
            key={index}
            variant="outline"
            className="w-full justify-start text-left h-auto py-3 px-4 hover:bg-primary/5 transition-colors"
            onClick={() => onQuestionSelect(sq.question)}
            disabled={loading}
          >
            <div className="flex items-start gap-3 w-full">
              <div className="flex-shrink-0 mt-0.5">
                <Badge 
                  variant="outline" 
                  className={`${getCategoryColor(sq.category)} text-xs flex items-center gap-1`}
                >
                  {getCategoryIcon(sq.category)}
                  {sq.category}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-relaxed">
                  {sq.question}
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {sq.reasoning}
                </p>
              </div>
              {sq.relevanceScore > 0.8 && (
                <Badge variant="secondary" className="text-xs flex-shrink-0">
                  {Math.round(sq.relevanceScore * 100)}%
                </Badge>
              )}
            </div>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
