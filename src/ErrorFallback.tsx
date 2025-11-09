import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";

import { Warning as AlertTriangleIcon, ArrowsClockwise as RefreshCwIcon } from "@phosphor-icons/react";
import type { FallbackProps } from "react-error-boundary";

export const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  // When encountering an error in the development mode, rethrow it and don't display the boundary.
  // The parent UI will take care of showing a more helpful dialog.
  if (import.meta.env.DEV) throw error;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>Runtime error in the application</AlertTitle>
          <AlertDescription>
            Something unexpected happened while running the application. The error details are shown below. If this persists, check your Cloudflare Worker runtime and environment configuration.
          </AlertDescription>
        </Alert>
        
        <div className="bg-card border rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-sm text-muted-foreground mb-2">Error Details:</h3>
          <pre className="max-h-48 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/50 p-3 text-xs text-status-error">
            {error.message}
          </pre>
        </div>
        
        <Button 
          onClick={resetErrorBoundary} 
          className="w-full"
          variant="outline"
        >
          <RefreshCwIcon />
          Try Again
        </Button>
      </div>
    </div>
  );
}
