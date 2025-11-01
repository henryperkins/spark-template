import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { githubService } from '@/lib/integrations/github-service'
import { GitHubRepo, Document } from '@/types'
import { GithubLogo, Check, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface GitHubIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function GitHubIngestion({ onDocumentsIngested }: GitHubIngestionProps) {
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
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="github-owner">Owner</Label>
            <Input
              id="github-owner"
              placeholder="facebook"
              value={config.owner}
              onChange={(e) => setConfig({ ...config, owner: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="github-repo">Repository</Label>
            <Input
              id="github-repo"
              placeholder="react"
              value={config.repo}
              onChange={(e) => setConfig({ ...config, repo: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="github-branch">Branch (optional)</Label>
            <Input
              id="github-branch"
              placeholder="main"
              value={config.branch}
              onChange={(e) => setConfig({ ...config, branch: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="github-path">Path (optional)</Label>
            <Input
              id="github-path"
              placeholder="docs/"
              value={config.path}
              onChange={(e) => setConfig({ ...config, path: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="github-token">Personal Access Token (optional)</Label>
          <Input
            id="github-token"
            type="password"
            placeholder="ghp_xxxxxxxxxxxx"
            value={config.token}
            onChange={(e) => setConfig({ ...config, token: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Required for private repositories or to increase rate limits
          </p>
        </div>

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
