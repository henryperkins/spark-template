import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { websiteService } from '@/lib/integrations/website-service'
import { WebsiteConfig, Document } from '@/types'
import { Globe, Check, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Slider } from '@/components/ui/slider'

interface WebsiteIngestionProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function WebsiteIngestion({ onDocumentsIngested }: WebsiteIngestionProps) {
  const [config, setConfig] = useState<WebsiteConfig>({
    url: '',
    maxDepth: 2,
    maxPages: 50,
  })
  const [isValidating, setIsValidating] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)

  const handleValidate = async () => {
    if (!config.url) {
      toast.error('URL is required')
      return
    }

    setIsValidating(true)
    setValidationResult(null)

    try {
      const result = await websiteService.validateConfig(config)
      setValidationResult(result)
      
      if (result.valid) {
        toast.success('Website is accessible')
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

  const handleScrape = async () => {
    if (!validationResult?.valid) {
      toast.error('Please validate the URL first')
      return
    }

    setIsScraping(true)

    try {
      const documents = await websiteService.scrapeWebsite(config)
      onDocumentsIngested(documents)
      toast.success(`Scraped ${documents.length} pages from website`)
      
      setConfig({
        url: '',
        maxDepth: 2,
        maxPages: 50,
      })
      setValidationResult(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error(errorMessage)
    } finally {
      setIsScraping(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe size={24} className="text-primary" />
          <div>
            <CardTitle>Website Scraper</CardTitle>
            <CardDescription>Scrape and ingest content from websites</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="website-url">Website URL</Label>
          <Input
            id="website-url"
            type="url"
            placeholder="https://example.com"
            value={config.url}
            onChange={(e) => setConfig({ ...config, url: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="max-depth">Max Depth: {config.maxDepth}</Label>
          </div>
          <Slider
            id="max-depth"
            min={1}
            max={5}
            step={1}
            value={[config.maxDepth || 2]}
            onValueChange={(value) => setConfig({ ...config, maxDepth: value[0] })}
          />
          <p className="text-xs text-muted-foreground">
            Number of link levels to follow from the starting URL
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="max-pages">Max Pages: {config.maxPages}</Label>
          </div>
          <Slider
            id="max-pages"
            min={10}
            max={200}
            step={10}
            value={[config.maxPages || 50]}
            onValueChange={(value) => setConfig({ ...config, maxPages: value[0] })}
          />
          <p className="text-xs text-muted-foreground">
            Maximum number of pages to scrape
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
                  ? 'Website is accessible'
                  : validationResult.error || 'Validation failed'}
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleValidate}
            disabled={isValidating || !config.url}
            variant="outline"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </Button>
          <Button
            onClick={handleScrape}
            disabled={!validationResult?.valid || isScraping}
          >
            {isScraping ? 'Scraping...' : 'Scrape Website'}
          </Button>
        </div>

        {isScraping && (
          <Alert>
            <AlertDescription>
              Scraping in progress... This may take a few minutes depending on the number of pages.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
