import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { oneDriveService } from '@/lib/integrations/onedrive-service'
import { OneDriveConfig, Document } from '@/types'
import { MicrosoftOutlookLogo, Check, Warning, Info } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface OneDriveIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function OneDriveIngestion({ onDocumentsIngested }: OneDriveIngestionProps) {
  const [config, setConfig] = useState<OneDriveConfig>({
    accessToken: '',
    path: '',
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)

  const handleValidate = async () => {
    if (!config.accessToken) {
      toast.error('Access token is required')
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await oneDriveService.validateConfig(config)
      setValidationResult(result)

      if (result.valid) {
        toast.success('OneDrive connection validated successfully')
      } else {
        toast.error(result.error || 'Validation failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setValidationResult({ valid: false, error: errorMessage })
      toast.error(errorMessage)
    } finally {
      setIsValidating(false)
    }
  }

  const handleIngest = async () => {
    if (!validationResult?.valid) {
      toast.error('Please validate the connection first')
      return
    }

    setIsIngesting(true)

    try {
      const documents = await oneDriveService.ingestFiles(config)
      onDocumentsIngested(documents)
      toast.success(`Ingested ${documents.length} files from OneDrive`)

      setConfig({
        accessToken: '',
        path: '',
      })
      setValidationResult(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error(errorMessage)
    } finally {
      setIsIngesting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MicrosoftOutlookLogo size={24} className="text-primary" />
          <div>
            <CardTitle>OneDrive</CardTitle>
            <CardDescription>Import files from your OneDrive account</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); }}>
          <Alert>
            <Info size={16} />
            <AlertDescription>
              To get an access token, register an app at{' '}
              <a
                href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Azure Portal
              </a>
              {' '}with Microsoft Graph Files.Read permission and use the Microsoft Authentication Library.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="onedrive-token">Access Token</Label>
            <Input
              id="onedrive-token"
              name="onedrive-access-token"
              type="password"
              placeholder="eyJ0eXAiOiJKV1QiLCJhb..."
              value={config.accessToken}
              onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onedrive-path">Path (optional)</Label>
            <Input
              id="onedrive-path"
              name="onedrive-path"
              placeholder="Documents/Work"
              value={config.path}
              onChange={(e) => setConfig({ ...config, path: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to sync all files, or specify a folder path
            </p>
          </div>
        </form>

        {validationResult && (
          <Alert variant={validationResult.valid ? 'default' : 'destructive'}>
            <div className="flex items-center gap-2">
              {validationResult.valid ? (
                <Check size={16} className="text-primary" />
              ) : (
                <Warning size={16} />
              )}
              <AlertDescription>
                {validationResult.valid
                  ? 'OneDrive connection is valid'
                  : validationResult.error || 'Validation failed'}
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleValidate}
            disabled={isValidating || !config.accessToken}
            variant="outline"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>
          <Button
            onClick={handleIngest}
            disabled={!validationResult?.valid || isIngesting}
          >
            {isIngesting ? 'Ingesting...' : 'Ingest Files'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
