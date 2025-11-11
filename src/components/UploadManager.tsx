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
  const {
    queue,
    retryUpload,
    removeFromQueue,
    hydrateFromStorage
  } = useUploadQueue()

  useEffect(() => {
    if (typeof hydrateFromStorage === 'function') {
      hydrateFromStorage()
    }
  }, [hydrateFromStorage])

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
            const canRetry = isError && typeof retryUpload === 'function'
            const canRemove =
              (isDone || isError) && typeof removeFromQueue === 'function'

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
                        size="xs"
                        variant="outline"
                        onClick={() => retryUpload?.(item.id)}
                      >
                        Retry
                      </Button>
                    )}
                    {canRemove && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => removeFromQueue?.(item.id)}
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