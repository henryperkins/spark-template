import { useEffect, useId, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { dropboxService } from '@/lib/integrations/dropbox-service'
import { DropboxConfig, Document } from '@/types'
import { DropboxLogo, Check, Warning, Info, Key } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { secureTokenStorage } from '@/lib/services/secure-token-storage'
import { useOAuth, getOAuthConfig } from '@/hooks/use-oauth'

interface DropboxIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function DropboxIngestion({ onDocumentsIngested }: DropboxIngestionProps) {
  const idPrefix = useId()
  const [config, setConfig] = useState<DropboxConfig>({
    accessToken: '',
    path: '',
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)

  const { initiateOAuth, checkOAuthResult, loading: oauthLoading } = useOAuth()

  useEffect(() => {
    const result = checkOAuthResult()
    if (result.success) {
      setIsAuthenticated(true)
      toast.success('Dropbox connected successfully.')
    } else if (result.error) {
      toast.error(`Dropbox OAuth failed: ${result.error}`)
    }
  }, [checkOAuthResult])

  useEffect(() => {
    let cancelled = false
    secureTokenStorage
      .getToken('dropbox')
      .then((token) => {
        if (cancelled || !token) return
        setConfig((prev) => ({ ...prev, accessToken: token }))
        setIsAuthenticated(true)
      })
      .catch(() => {
        // Ignore token retrieval errors (likely dev without KV)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleValidate = async () => {
    if (!config.accessToken) {
      toast.error('Access token is required')
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await dropboxService.validateConfig(config)
      setValidationResult(result)
      
      if (result.valid) {
        setIsAuthenticated(true)
        toast.success('Dropbox connection validated successfully')
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
          await secureTokenStorage.setToken('dropbox', config.accessToken)
          setIsAuthenticated(true)
        } catch (error) {
          console.warn('Could not persist Dropbox access token:', error)
        }
      }

      const documents = await dropboxService.ingestFiles(config)
      onDocumentsIngested(documents)
      toast.success(`Ingested ${documents.length} files from Dropbox`)
      
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
          <DropboxLogo size={24} className="text-primary" />
          <div>
            <CardTitle>Dropbox</CardTitle>
            <CardDescription>Import files from your Dropbox account</CardDescription>
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
                    const oauthConfig = getOAuthConfig('dropbox')
                    if (!oauthConfig.clientId) {
                      toast.error('Dropbox OAuth not configured. Use a manual token instead.')
                      setShowTokenInput(true)
                      return
                    }
                    initiateOAuth({ ...oauthConfig, provider: 'dropbox' })
                  }}
                  disabled={oauthLoading}
                >
                  <DropboxLogo size={16} className="mr-2" />
                  Connect with Dropbox OAuth
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
                      id={`${idPrefix}-dropbox-token`}
                      name="dropbox-access-token"
                      type="password"
                      placeholder="sl.xxxxxxxxxxxxxx"
                      value={config.accessToken}
                      onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
                    />
                    <Alert>
                      <Info size={14} />
                      <AlertDescription>
                        Generate a short-lived access token in the{' '}
                        <a
                          href="https://www.dropbox.com/developers/apps"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Dropbox App Console
                        </a>
                        . Tokens are stored securely but should be rotated periodically.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </div>
            ) : (
              <Alert>
                <Check size={16} className="text-primary" />
                <AlertDescription>
                  Dropbox account connected. You can continue to update settings or ingest files.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              OAuth is recommended. Manual tokens are available for advanced or temporary use.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-dropbox-path`}>Path (optional)</Label>
            <Input
              id={`${idPrefix}-dropbox-path`}
              name="dropbox-path"
              placeholder="/Documents"
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
                  ? 'Dropbox connection is valid'
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
