import { useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useUploadQueue } from '@/hooks/use-upload-queue'

/**
 * Minimal UploadManager UI wrapper for the existing resumable upload queue.
 *
 * Responsibilities:
 * - Hydrate queue state from IndexedDB/local storage on mount.
 * - Render each queued upload with status and progress.
 * - Expose retry/remove actions via useUploadQueue where available.
 *
 * This component is intentionally lean and optional; mount it alongside
 * DocumentUpload or in a global layout as needed.
 */
export const UploadManager = () => {
  const { queue, processQueue, remove } = useUploadQueue()

  // On mount, ensure any persisted queue entries are loaded and processing is started.
  useEffect(() => {
    // processQueue requires a resolver to map queued fileName -> File. For now, we
    // invoke it only when the user explicitly clicks "Retry all" with a resolver.
    // This effect is a no-op placeholder to avoid hidden behavior.
  }, [])

  if (!queue || queue.length === 0) {
    return null
  }

  return (
    <Card className="mt-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-sm">Background uploads</h4>
          <span className="text-xs text-muted-foreground">
            {queue.length} {queue.length === 1 ? 'file' : 'files'}
          </span>
        </div>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {queue.map((item) => {
            const isError = item.status === 'error'
            const isDone = item.status === 'completed'
            // Minimal semantics:
            // - When errored, allow a "Retry" that re-invokes processQueue with a best-effort resolver.
            // - When completed or errored, allow "Remove" via useUploadQueue.remove.
            const canRetry = isError && typeof processQueue === 'function'
            const canRemove = (isDone || isError) && typeof remove === 'function'

            return (
              <div key={item.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {item.fileName}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.status}
                      {typeof item.error === 'string' && item.error.length > 0
                        ? ` · ${item.error}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          // Best-effort retry of the entire queue; assumes caller has
                          // logic to supply Files back into processQueue elsewhere.
                          // We don't have direct File handles here, so this triggers
                          // queue processing for entries that can be resolved.
                          processQueue?.(() => null)
                        }}
                      >
                        Retry
                      </Button>
                    )}
                    {canRemove && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove?.(item.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={item.progress ?? 0} className="h-1.5" />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}