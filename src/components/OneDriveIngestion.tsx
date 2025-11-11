import { useCallback, useEffect, useId, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { oneDriveService } from '@/lib/integrations/onedrive-service'
import { OneDriveConfig, Document } from '@/types'
import { MicrosoftOutlookLogo, Check, Warning, Info, Key } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { secureTokenStorage } from '@/lib/services/secure-token-storage'
import { useOAuth, getOAuthConfig } from '@/hooks/use-oauth'

interface OneDriveIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function OneDriveIngestion({ onDocumentsIngested }: OneDriveIngestionProps) {
  const idPrefix = useId()
  const [config, setConfig] = useState<OneDriveConfig>({
    accessToken: '',
    path: '',
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)

  const { initiateOAuth, checkOAuthResult, loading: oauthLoading } = useOAuth()

  const fetchTokenFromWorker = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/oauth/onedrive/token', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
      if (!response.ok) {
        return null
      }

      const data = await response.json().catch(() => null)
      const token = typeof data?.accessToken === 'string' ? data.accessToken : null
      if (!token) {
        return null
      }

      if (typeof window !== 'undefined') {
        try {
          await secureTokenStorage.setToken('onedrive', token)
        } catch (error) {
          console.warn('OneDriveIngestion: unable to persist OAuth token to secure storage', error)
        }
      }

      return token
    } catch (error) {
      console.warn('OneDriveIngestion: failed to fetch OAuth token from Worker', error)
      return null
    }
  }, [])

  useEffect(() => {
    const result = checkOAuthResult()
    if (result.success) {
      toast.success('OneDrive connected successfully.')
      fetchTokenFromWorker().then((token) => {
        if (token) {
          setConfig((prev) => ({ ...prev, accessToken: token }))
          setIsAuthenticated(true)
        } else {
          setIsAuthenticated(true)
        }
      })
    } else if (result.error) {
      toast.error(`OneDrive OAuth failed: ${result.error}`)
    }
  }, [checkOAuthResult, fetchTokenFromWorker])

  useEffect(() => {
    let cancelled = false
    const hydrateToken = async () => {
      try {
        const stored = await secureTokenStorage.getToken('onedrive')
        if (!cancelled && stored) {
          setConfig((prev) => ({ ...prev, accessToken: stored }))
          setIsAuthenticated(true)
          return
        }
      } catch {
        // Ignore token retrieval errors (likely dev without KV)
      }

      if (cancelled) return
      const token = await fetchTokenFromWorker()
      if (!cancelled && token) {
        setConfig((prev) => ({ ...prev, accessToken: token }))
        setIsAuthenticated(true)
      }
    }

    hydrateToken()

    return () => {
      cancelled = true
    }
  }, [fetchTokenFromWorker])

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
        setIsAuthenticated(true)
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
      if (config.accessToken) {
        try {
          await secureTokenStorage.setToken('onedrive', config.accessToken)
          setIsAuthenticated(true)
        } catch (error) {
          console.warn('Could not persist OneDrive access token:', error)
        }
      }

      const documents = await oneDriveService.ingestFiles(config)
      onDocumentsIngested(documents)
      toast.success(`Ingested ${documents.length} files from OneDrive`)

      setConfig((prev) => ({
        accessToken: isAuthenticated ? prev.accessToken : '',
        path: '',
      }))
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
          <div className="space-y-3">
            <Label>Authentication</Label>

            {!isAuthenticated ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    const oauthConfig = getOAuthConfig('onedrive')
                    if (!oauthConfig.clientId) {
                      toast.error('OneDrive OAuth not configured. Use a manual token instead.')
                      setShowTokenInput(true)
                      return
                    }
                    initiateOAuth({ ...oauthConfig, provider: 'onedrive' })
                  }}
                  disabled={oauthLoading}
                >
                  <MicrosoftOutlookLogo size={16} className="mr-2" />
                  Connect with OneDrive OAuth
                </Button>

                {!showTokenInput && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => setShowTokenInput(true)}
                  >
                    <Key size={14} className="mr-1" />
                    Use Manual Access Token
                  </Button>
                )}

                {showTokenInput && (
                  <div className="space-y-2">
                    <Input
                      id={`${idPrefix}-onedrive-token`}
                      name="onedrive-access-token"
                      type="password"
                      placeholder="eyJ0eXAiOiJKV1QiLCJhb..."
                      value={config.accessToken}
                      onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
                    />
                    <Alert>
                      <Info size={14} />
                      <AlertDescription>
                        Register an app in the{' '}
                        <a
                          href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Azure Portal
                        </a>{' '}
                        and generate a delegated token with Files.Read permissions. Tokens are stored securely but should be refreshed regularly.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </div>
            ) : (
              <Alert>
                <Check size={16} className="text-primary" />
                <AlertDescription>
                  OneDrive account connected. OAuth tokens are stored securely and will be reused.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              OAuth is recommended. Manual tokens are available for advanced or temporary use.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-onedrive-path`}>Path (optional)</Label>
            <Input
              id={`${idPrefix}-onedrive-path`}
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
