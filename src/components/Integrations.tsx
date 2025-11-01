import React from 'react'
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
        <h2 className="text-2xl font-semibold mb-2">Data Integrations</h2>
        <p className="text-muted-foreground">
          Connect external data sources to automatically ingest and index content
        </p>
      </div>

      <Tabs defaultValue="github" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="github" className="flex items-center gap-2">
            <GithubLogo size={16} />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="website" className="flex items-center gap-2">
            <Globe size={16} />
            Website
          </TabsTrigger>
          <TabsTrigger value="dropbox" className="flex items-center gap-2">
            <DropboxLogo size={16} />
            Dropbox
          </TabsTrigger>
          <TabsTrigger value="onedrive" className="flex items-center gap-2">
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
