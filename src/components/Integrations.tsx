import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitHubIngestion } from '@/components/GitHubIngestion'
import { WebsiteIngestion } from '@/components/WebsiteIngestion'
import { DropboxIngestion } from '@/components/DropboxIngestion'
import { OneDriveIngestion } from '@/components/OneDriveIngestion'
import { Document } from '@/types'
import { GithubLogo, Globe, DropboxLogo, MicrosoftOutlookLogo } from '@phosphor-icons/react'

interface IntegrationsProps {
  onDocumentsIngested: (documents: Document[]) => void
}

export function Integrations({ onDocumentsIngested }: IntegrationsProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1">Data integrations</h2>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
          Connect code, sites, and cloud storage so new content flows automatically into your knowledge base.
          Each connector normalizes metadata and can optionally push to Azure for indexing.
        </p>
      </div>

      <Tabs defaultValue="github" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger
            value="github"
            className="flex items-center gap-2 text-xs sm:text-sm"
          >
            <GithubLogo size={16} />
            GitHub
          </TabsTrigger>
          <TabsTrigger
            value="website"
            className="flex items-center gap-2 text-xs sm:text-sm"
          >
            <Globe size={16} />
            Website
          </TabsTrigger>
          <TabsTrigger
            value="dropbox"
            className="flex items-center gap-2 text-xs sm:text-sm"
          >
            <DropboxLogo size={16} />
            Dropbox
          </TabsTrigger>
          <TabsTrigger
            value="onedrive"
            className="flex items-center gap-2 text-xs sm:text-sm"
          >
            <MicrosoftOutlookLogo size={16} />
            OneDrive
          </TabsTrigger>
        </TabsList>

        <TabsContent value="github">
          <GitHubIngestion onDocumentsIngested={onDocumentsIngested} />
        </TabsContent>

        <TabsContent value="website">
          <WebsiteIngestion onDocumentsIngested={onDocumentsIngested} />
        </TabsContent>

        <TabsContent value="dropbox">
          <DropboxIngestion onDocumentsIngested={onDocumentsIngested} />
        </TabsContent>

        <TabsContent value="onedrive">
          <OneDriveIngestion onDocumentsIngested={onDocumentsIngested} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
