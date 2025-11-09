import { useState, useId, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { githubService } from '@/lib/integrations/github-service'
import { GitHubRepo, Document } from '@/types'
import { GithubLogo, Check, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { secureTokenStorage } from '@/lib/services/secure-token-storage'

interface GitHubIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function GitHubIngestion({ onDocumentsIngested }: GitHubIngestionProps) {
  const idPrefix = useId()
  const [config, setConfig] = useState<GitHubRepo>({
    owner: '',
    repo: '',
    branch: 'main',
    path: '',
    token: '',
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)

  // Load any previously saved token on mount
  useEffect(() => {
    let mounted = true
    secureTokenStorage.getToken('github').then((token) => {
      if (!mounted || !token) return
      setConfig(prev => ({ ...prev, token }))
    }).catch(() => {
      // ignore token load failures
    })
    return () => {
      mounted = false
    }
  }, [])

  const handleValidate = async () => {
    if (!config.owner || !config.repo) {
      toast.error('Owner and repository are required')
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await githubService.validateConfig(config)
      setValidationResult(result)
      
      if (result.valid) {
        toast.success('Repository validated successfully')
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
      toast.error('Please validate the repository first')
      return
    }

    setIsIngesting(true)

    try {
      // Store token securely before ingesting (gracefully degrade if KV not available)
      if (config.token) {
        try {
          await secureTokenStorage.setToken('github', config.token)
        } catch (error) {
          // KV not available in dev - token won't be persisted but ingestion can continue
          console.warn('Could not persist GitHub token (KV storage not available):', error)
        }
      }

      const documents = await githubService.ingestRepo(config)
      onDocumentsIngested(documents)
      toast.success(`Ingested ${documents.length} files from repository`)
      
      setConfig({
        owner: '',
        repo: '',
        branch: 'main',
        path: '',
        token: '',
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
          <GithubLogo size={24} className="text-primary" />
          <div>
            <CardTitle>GitHub Repository</CardTitle>
            <CardDescription>Import files from a GitHub repository</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); }}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-github-owner`}>Owner</Label>
              <Input
                id={`${idPrefix}-github-owner`}
                name="owner"
                placeholder="facebook"
                value={config.owner}
                onChange={(e) => setConfig({ ...config, owner: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-github-repo`}>Repository</Label>
              <Input
                id={`${idPrefix}-github-repo`}
                name="repo"
                placeholder="react"
                value={config.repo}
                onChange={(e) => setConfig({ ...config, repo: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-github-branch`}>Branch (optional)</Label>
              <Input
                id={`${idPrefix}-github-branch`}
                name="branch"
                placeholder="main"
                value={config.branch}
                onChange={(e) => setConfig({ ...config, branch: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-github-path`}>Path (optional)</Label>
              <Input
                id={`${idPrefix}-github-path`}
                name="path"
                placeholder="docs/"
                value={config.path}
                onChange={(e) => setConfig({ ...config, path: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-github-token`}>Personal Access Token (optional)</Label>
            <Input
              id={`${idPrefix}-github-token`}
              name="token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxx"
              value={config.token}
              onChange={(e) => setConfig({ ...config, token: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Required for private repositories or to increase rate limits
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
                  ? 'Repository is accessible'
                  : validationResult.error || 'Validation failed'}
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleValidate}
            disabled={isValidating || !config.owner || !config.repo}
            variant="outline"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>
          <Button
            onClick={handleIngest}
            disabled={!validationResult?.valid || isIngesting}
          >
            {isIngesting ? 'Ingesting...' : 'Ingest Repository'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
