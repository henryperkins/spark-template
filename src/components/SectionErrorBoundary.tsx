import { type ReactNode, type ErrorInfo, useId } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ArrowsClockwise, Warning } from '@phosphor-icons/react'
import { errorTracking } from '@/lib/services/error-tracker'
import { captureSentryException, withSentryScope } from '@/lib/services/sentry-client'

interface SectionErrorBoundaryProps {
  section: string
  children: ReactNode
}

function SectionErrorFallback({ error, resetErrorBoundary, section }: FallbackProps & { section: string }) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <div
      role="alert"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <div className="flex items-start gap-3">
        <Warning size={18} className="mt-0.5" />
        <div className="flex-1 space-y-2">
          <div id={titleId} className="font-semibold">
            {section} is temporarily unavailable
          </div>
          <div id={descriptionId} className="text-muted-foreground">
            Something went wrong while rendering this section. You can try again, and the rest of the application
            remains available.
          </div>
          <details className="rounded bg-background/80 p-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground">
              Error details
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{error.message}</pre>
          </details>
          <Button
            onClick={resetErrorBoundary}
            variant="outline"
            size="sm"
            className="mt-1 inline-flex items-center gap-1"
          >
            <ArrowsClockwise size={14} />
            Retry section
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SectionErrorBoundary({ section, children }: SectionErrorBoundaryProps) {
  const handleError = (error: Error, info: ErrorInfo) => {
    withSentryScope(scope => {
      scope.setTags({
        section
      })
      scope.setExtras({
        componentStack: info.componentStack ?? ''
      })
    })

    captureSentryException(error)

    errorTracking.record(error, {
      type: 'runtime',
      agent: section,
      metadata: {
        componentStack: info.componentStack
      }
    })
  }

  return (
    <ErrorBoundary
      onError={handleError}
      fallbackRender={(props) => (
        <SectionErrorFallback
          {...props}
          section={section}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
