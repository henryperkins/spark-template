import { useState, useEffect, useId } from 'react'
import { useStorage } from '@/hooks/use-kv'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CloudArrowUp, CloudCheck, CloudX, Eye, EyeSlash, TestTube, Sparkle, Lightning, FloppyDisk, Trash, FolderOpen } from '@phosphor-icons/react'
import { AzureConfig, AzureConnectionStatus, SavedAzureConfig } from '@/types'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { isCloudflareKVConfigured, testCloudflareKV } from '@/lib/cloudflare-kv'

export function AzureConfiguration() {
  const idPrefix = useId()
  const [config, setConfig] = useStorage<AzureConfig | null>('azure-config', null)
  const [status, setStatus] = useStorage<AzureConnectionStatus | null>('azure-status', null)
  const [savedConfigs, setSavedConfigs] = useStorage<SavedAzureConfig[]>('azure-saved-configs', [])
  const [formData, setFormData] = useState<AzureConfig>({
    openai: {
      endpoint: '',
      apiKey: '',
      deploymentName: '',
      embeddingDeploymentName: '',
      apiVersion: '2025-08-01-preview',
      useResponsesApi: false,
      responsesStore: false,
      responsesBackground: false,
      responsesApiVersion: 'v1'
    },
    search: {
      endpoint: '',
      apiKey: '',
      indexName: 'documents',
      apiVersion: '2025-08-01-preview',
      vectorDimensions: 1536,
      semanticConfiguration: {
        enabled: true,
        configName: 'semantic-config',
        prioritizeTitle: true,
        prioritizeKeywords: true
      },
      vectorCompression: {
        enabled: false,
        method: 'scalar'
      },
      customScoring: {
        enabled: true,
        recencyWeight: 2.0,
        lengthWeight: 1.5,
        metadataWeight: 0.3
      }
    }
  })
  const [testing, setTesting] = useState(false)
  const [showKeys, setShowKeys] = useState({ openai: false, search: false })
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [configName, setConfigName] = useState('')
  const [configDescription, setConfigDescription] = useState('')
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [rebuildingIndex, setRebuildingIndex] = useState(false)
  const [rebuildResult, setRebuildResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [storageHealth, setStorageHealth] = useState<{ status: 'connected' | 'disconnected' | 'error' | 'testing', message?: string }>({ status: 'testing' })

  const inferDimensionsFromDeployment = (deploymentName: string | undefined): number => {
    const normalized = deploymentName?.toLowerCase() ?? ''
    if (normalized.includes('text-embedding-3-large')) {
      return 3072
    }
    return 1536
  }

  useEffect(() => {
    if (config) {
      setFormData({
        ...config,
        search: {
          ...config.search,
          vectorDimensions:
            config.search.vectorDimensions ?? inferDimensionsFromDeployment(config.openai.embeddingDeploymentName)
        }
      })
    }
  }, [config])

  // Evaluate Storage Health (Cloudflare KV or Local)
  useEffect(() => {
    let mounted = true
    const run = async () => {
      setStorageHealth({ status: 'testing' })
      try {
        if (isCloudflareKVConfigured()) {
          const ok = await testCloudflareKV()
          if (!mounted) return
          setStorageHealth(ok ? { status: 'connected' } : { status: 'error', message: 'Cloudflare KV test failed' })
        } else {
          setStorageHealth({
            status: 'disconnected',
            message: 'Cloudflare KV not configured — falling back to localStorage (≈5 MB limit)'
          })
        }
      } catch (e) {
        if (!mounted) return
        setStorageHealth({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [])

  // Save current configuration
  const handleSaveConfig = () => {
    if (!configName.trim()) return

    const newConfig: SavedAzureConfig = {
      id: Date.now().toString(),
      name: configName.trim(),
      description: configDescription.trim() || undefined,
      config: formData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setSavedConfigs([...(savedConfigs || []), newConfig])
    setConfigName('')
    setConfigDescription('')
    setSaveDialogOpen(false)
  }

  // Load a saved configuration
  const handleLoadConfig = (configId: string) => {
    const savedConfig = savedConfigs?.find(c => c.id === configId)
    if (savedConfig) {
      setFormData({
        ...savedConfig.config,
        search: {
          ...savedConfig.config.search,
          vectorDimensions:
            savedConfig.config.search.vectorDimensions ??
            inferDimensionsFromDeployment(savedConfig.config.openai.embeddingDeploymentName)
        }
      })
      setSelectedConfigId(configId)
      setRebuildResult(null)
    }
  }

  // Delete a saved configuration
  const handleDeleteConfig = (configId: string) => {
    setSavedConfigs((savedConfigs || []).filter(c => c.id !== configId))
    if (selectedConfigId === configId) {
      setSelectedConfigId('')
    }
  }

  // Update an existing saved configuration
  const handleUpdateConfig = (configId: string) => {
    const updatedConfigs = (savedConfigs || []).map(c =>
      c.id === configId
        ? { ...c, config: formData, updatedAt: new Date().toISOString() }
        : c
    )
    setSavedConfigs(updatedConfigs)
  }

  const handleInputChange = (service: 'openai' | 'search', field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [service]: {
        ...prev[service],
        [field]: value
      }
    }))
  }

  const handleVectorDimensionsChange = (value: string) => {
    setFormData(prev => {
      if (!value) {
        const updatedSearch = { ...prev.search }
        delete (updatedSearch as { vectorDimensions?: number }).vectorDimensions
        return { ...prev, search: updatedSearch }
      }

      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return prev
      }

      return {
        ...prev,
        search: {
          ...prev.search,
          vectorDimensions: Math.floor(parsed)
        }
      }
    })
  }

  const searchConfigReady = Boolean(formData.search.endpoint && formData.search.apiKey && formData.search.indexName)
  const effectiveVectorDimensions =
    formData.search.vectorDimensions ?? inferDimensionsFromDeployment(formData.openai.embeddingDeploymentName)

  const testConnection = async () => {
    setTesting(true)
    setRebuildResult(null)
    try {
      const newStatus = await azureServiceManager.initialize(formData)
      setStatus(newStatus)
    } catch (error) {
      // Preserve detailed error information without forcing both services to "error"
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus({
        openai: 'error',
        search: 'error',
        lastTested: new Date().toISOString(),
        errors: {
          openai: message,
          search: message
        }
      })
    } finally {
      setTesting(false)
    }
  }

  const rebuildIndex = async () => {
    if (!searchConfigReady) {
      setRebuildResult({
        type: 'error',
        message: 'Provide your search endpoint, index name, and admin key before rebuilding.'
      })
      return
    }

    setRebuildingIndex(true)
    setRebuildResult(null)
    try {
      const result = await azureServiceManager.rebuildSearchIndex(formData, effectiveVectorDimensions)
      if (result.success) {
        setRebuildResult({
          type: 'success',
          message: `Index '${formData.search.indexName}' rebuilt with ${effectiveVectorDimensions} vector dimensions.`
        })
      } else {
        const errorMessage = result.error ?? 'Index rebuild failed for an unknown reason.'
        const enhancedMessage = errorMessage.includes("Existing field 'contentVector' cannot be changed")
          ? `${errorMessage} Azure may still be removing the previous index. Wait 30–120 seconds and try again.`
          : errorMessage
        setRebuildResult({
          type: 'error',
          message: enhancedMessage
        })
      }
    } catch (error) {
      setRebuildResult({
        type: 'error',
        message: error instanceof Error ? error.message : 'Index rebuild failed due to an unknown error.'
      })
    } finally {
      setRebuildingIndex(false)
    }
  }

  const saveConfiguration = async () => {
    await testConnection()
    setConfig(formData)
  }

  const STATUS_ICON_SIZE = 18

  const getStatusIcon = (serviceStatus: string) => {
    switch (serviceStatus) {
      case 'connected':
        return <CloudCheck className="text-status-success" size={STATUS_ICON_SIZE} />
      case 'error':
        return <CloudX className="text-status-error" size={STATUS_ICON_SIZE} />
      case 'testing':
        return <TestTube className="text-status-info animate-pulse" size={STATUS_ICON_SIZE} />
      default:
        return <CloudArrowUp className="text-muted-foreground" size={STATUS_ICON_SIZE} />
    }
  }

  const getStatusBadge = (serviceStatus: string) => {
    const variants = {
      connected: 'default',
      error: 'destructive',
      testing: 'secondary',
      disconnected: 'outline'
    } as const

    return (
      <Badge variant={variants[serviceStatus as keyof typeof variants] || 'outline'}>
        {serviceStatus}
      </Badge>
    )
  }

  const isFormValid = () => {
    return (
      formData.openai.endpoint &&
      formData.openai.apiKey &&
      formData.openai.deploymentName &&
      formData.openai.embeddingDeploymentName &&
      formData.search.endpoint &&
      formData.search.apiKey
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudArrowUp size={20} />
            Azure Services Configuration
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Connect your Azure OpenAI and Azure AI Search services for enhanced AI capabilities
          </p>
        </CardHeader>
        <CardContent>
          {/* Saved Configurations Section */}
          <div className="mb-6 p-4 border rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium flex items-center gap-2">
                  <FolderOpen size={16} />
                  Saved Configurations
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Save and load different Azure configurations
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Load Configuration */}
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-load-config`}>Load Configuration</Label>
                <Select value={selectedConfigId} onValueChange={handleLoadConfig}>
                  <SelectTrigger id={`${idPrefix}-load-config`}>
                    <SelectValue placeholder="Select a saved configuration" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedConfigs && savedConfigs.length > 0 ? (
                      savedConfigs.map((cfg) => (
                        <SelectItem key={cfg.id} value={cfg.id}>
                          <div className="flex flex-col">
                            <span>{cfg.name}</span>
                            {cfg.description && (
                              <span className="text-xs text-muted-foreground">{cfg.description}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No saved configurations
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <Label>Actions</Label>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setSaveDialogOpen(true)}
                    disabled={!isFormValid()}
                    variant="outline"
                    className="flex-1"
                  >
                    <FloppyDisk size={16} className="mr-2" />
                    Save Current
                  </Button>
                  {selectedConfigId && (
                    <>
                      <Button
                        onClick={() => handleUpdateConfig(selectedConfigId)}
                        disabled={!isFormValid()}
                        variant="outline"
                        size="icon"
                        title="Update selected config"
                      >
                        <FloppyDisk size={16} />
                      </Button>
                      <Button
                        onClick={() => handleDeleteConfig(selectedConfigId)}
                        variant="destructive"
                        size="icon"
                        title="Delete selected config"
                      >
                        <Trash size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Save Dialog */}
            {saveDialogOpen && (
              <div className="mt-4 p-4 border rounded-lg bg-muted/50 space-y-3">
                <h5 className="font-medium text-sm">Save Configuration</h5>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-config-name`}>Configuration Name *</Label>
                  <Input
                    id={`${idPrefix}-config-name`}
                    placeholder="e.g., Production, Development, Staging"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-config-description`}>Description (Optional)</Label>
                  <Input
                    id={`${idPrefix}-config-description`}
                    placeholder="Brief description of this configuration"
                    value={configDescription}
                    onChange={(e) => setConfigDescription(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveConfig}
                    disabled={!configName.trim()}
                    size="sm"
                  >
                    Save
                  </Button>
                  <Button
                    onClick={() => {
                      setSaveDialogOpen(false)
                      setConfigName('')
                      setConfigDescription('')
                    }}
                    variant="outline"
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {status && (
            <div className="mb-6 p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">Connection Status</h4>
                <p className="text-xs text-muted-foreground">
                  Last tested: {new Date(status.lastTested!).toLocaleString()}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  {getStatusIcon(status.openai)}
                  <span className="text-sm">Azure OpenAI</span>
                  {getStatusBadge(status.openai)}
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(status.search)}
                  <span className="text-sm">Azure AI Search</span>
                  {getStatusBadge(status.search)}
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(storageHealth.status)}
                  <span className="text-sm">Storage (Cloudflare KV)</span>
                  {getStatusBadge(storageHealth.status)}
                </div>
              </div>
              {status.errors && (
                <div className="mt-3 space-y-2">
                  {status.errors.openai && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        <strong>Azure OpenAI:</strong> {status.errors.openai}
                      </AlertDescription>
                    </Alert>
                  )}
                  {status.errors.search && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        <strong>Azure AI Search:</strong> {status.errors.search}
                      </AlertDescription>
                    </Alert>
                  )}
                  {storageHealth.message && (
                    <Alert variant={storageHealth.status === 'connected' ? 'default' : 'destructive'}>
                      <AlertDescription>
                        <strong>Storage:</strong> {storageHealth.message}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}

          <Tabs defaultValue="openai" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="openai">Azure OpenAI</TabsTrigger>
              <TabsTrigger value="search">Azure AI Search</TabsTrigger>
              <TabsTrigger value="optimization">
                <Sparkle size={14} className="mr-1" />
                Optimization
              </TabsTrigger>
            </TabsList>

            <TabsContent value="openai" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-openai-endpoint`}>Endpoint URL</Label>
                  <Input
                    id={`${idPrefix}-openai-endpoint`}
                    placeholder="https://your-resource.openai.azure.com"
                    value={formData.openai.endpoint}
                    onChange={(e) => handleInputChange('openai', 'endpoint', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-openai-deployment`}>Chat Deployment Name</Label>
                  <Input
                    id={`${idPrefix}-openai-deployment`}
                    placeholder="gpt-4"
                    value={formData.openai.deploymentName}
                    onChange={(e) => handleInputChange('openai', 'deploymentName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-openai-embedding-deployment`}>Embedding Deployment Name</Label>
                  <Input
                    id={`${idPrefix}-openai-embedding-deployment`}
                    placeholder="text-embedding-ada-002"
                    value={formData.openai.embeddingDeploymentName}
                    onChange={(e) => handleInputChange('openai', 'embeddingDeploymentName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-openai-version`}>API Version</Label>
                  <Input
                    id={`${idPrefix}-openai-version`}
                    value={formData.openai.apiVersion}
                    onChange={(e) => handleInputChange('openai', 'apiVersion', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-openai-key`}>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id={`${idPrefix}-openai-key`}
                    name="openai-api-key"
                    type={showKeys.openai ? 'text' : 'password'}
                    placeholder="Your Azure OpenAI API key"
                    value={formData.openai.apiKey}
                    onChange={(e) => handleInputChange('openai', 'apiKey', e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowKeys(prev => ({ ...prev, openai: !prev.openai }))}
                  >
                    {showKeys.openai ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>

              {/* Responses API Configuration */}
              <div className="mt-6 p-4 border rounded-lg bg-muted/30 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkle size={18} className="text-primary" />
                  <h4 className="font-medium">Responses API (v1)</h4>
                  <Badge variant="outline" className="ml-auto">Advanced</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Use the new stateful v1 Responses API for chat and RAG (recommended for production)
                </p>

                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={`${idPrefix}-use-responses-api`} className="cursor-pointer">
                        Use v1 Responses API for chat and RAG
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Enables stateful conversations, tool calling, and advanced features
                      </p>
                    </div>
                    <Switch
                      id={`${idPrefix}-use-responses-api`}
                      checked={formData.openai.useResponsesApi ?? false}
                      onCheckedChange={(checked) =>
                        setFormData(prev => ({
                          ...prev,
                          openai: { ...prev.openai, useResponsesApi: checked }
                        }))
                      }
                    />
                  </div>

                  {formData.openai.useResponsesApi && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor={`${idPrefix}-responses-model`}>Responses Model (Optional)</Label>
                        <Input
                          id={`${idPrefix}-responses-model`}
                          placeholder={`Defaults to ${formData.openai.deploymentName || 'chat deployment'}`}
                          value={formData.openai.responsesModel ?? ''}
                          onChange={(e) =>
                            setFormData(prev => ({
                              ...prev,
                              openai: { ...prev.openai, responsesModel: e.target.value || undefined }
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Override the model used for Responses API calls
                        </p>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor={`${idPrefix}-responses-store`} className="cursor-pointer">
                            Store Responses by default
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            30-day retention for conversation chaining
                          </p>
                        </div>
                        <Switch
                          id={`${idPrefix}-responses-store`}
                          checked={formData.openai.responsesStore ?? false}
                          onCheckedChange={(checked) =>
                            setFormData(prev => ({
                              ...prev,
                              openai: { ...prev.openai, responsesStore: checked }
                            }))
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor={`${idPrefix}-responses-background`} className="cursor-pointer">
                            Run responses in background by default
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Async processing for long-running tasks
                          </p>
                        </div>
                        <Switch
                          id={`${idPrefix}-responses-background`}
                          checked={formData.openai.responsesBackground ?? false}
                          onCheckedChange={(checked) =>
                            setFormData(prev => ({
                              ...prev,
                              openai: { ...prev.openai, responsesBackground: checked }
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`${idPrefix}-responses-timeout`}>Responses Timeout (ms)</Label>
                        <Input
                          id={`${idPrefix}-responses-timeout`}
                          type="number"
                          min={0}
                          step={1000}
                          placeholder="Default: no timeout"
                          value={formData.openai.responsesTimeoutMs ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : undefined
                            setFormData(prev => ({
                              ...prev,
                              openai: { ...prev.openai, responsesTimeoutMs: val }
                            }))
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Request timeout in milliseconds (leave empty for no timeout)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`${idPrefix}-responses-api-version`}>Responses API Version</Label>
                        <Input
                          id={`${idPrefix}-responses-api-version`}
                          placeholder="v1"
                          value={formData.openai.responsesApiVersion ?? 'v1'}
                          onChange={(e) =>
                            setFormData(prev => ({
                              ...prev,
                              openai: { ...prev.openai, responsesApiVersion: e.target.value || 'v1' }
                            }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Azure OpenAI v1 API version (default: v1)
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="search" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-search-endpoint`}>Service URL</Label>
                  <Input
                    id={`${idPrefix}-search-endpoint`}
                    placeholder="https://your-service.search.windows.net"
                    value={formData.search.endpoint}
                    onChange={(e) => handleInputChange('search', 'endpoint', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-search-index`}>Index Name</Label>
                  <Input
                    id={`${idPrefix}-search-index`}
                    placeholder="documents"
                    value={formData.search.indexName}
                    onChange={(e) => handleInputChange('search', 'indexName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-search-version`}>API Version</Label>
                  <Input
                    id={`${idPrefix}-search-version`}
                    value={formData.search.apiVersion}
                    onChange={(e) => handleInputChange('search', 'apiVersion', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-search-key`}>Admin API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id={`${idPrefix}-search-key`}
                    name="search-api-key"
                    type={showKeys.search ? 'text' : 'password'}
                    placeholder="Your Azure AI Search admin key"
                    value={formData.search.apiKey}
                    onChange={(e) => handleInputChange('search', 'apiKey', e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowKeys(prev => ({ ...prev, search: !prev.search }))}
                  >
                    {showKeys.search ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-vector-dimensions`}>Vector Dimensions</Label>
                <Input
                  id={`${idPrefix}-vector-dimensions`}
                  type="number"
                  min={1}
                  step={1}
                  value={effectiveVectorDimensions}
                  onChange={(e) => handleVectorDimensionsChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use 3,072 for <code>text-embedding-3-large</code>, 1,536 for most other Azure OpenAI embedding models.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="optimization" className="space-y-6">
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkle size={18} className="text-primary" />
                      <h4 className="font-medium">Semantic Search</h4>
                    </div>
                    <Switch
                      checked={formData.search.semanticConfiguration?.enabled ?? true}
                      onCheckedChange={(enabled) => 
                        setFormData(prev => ({
                          ...prev,
                          search: {
                            ...prev.search,
                            semanticConfiguration: {
                              ...prev.search.semanticConfiguration!,
                              enabled
                            }
                          }
                        }))
                      }
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Enable semantic ranking for better understanding of query intent and content relevance
                  </p>
                  {formData.search.semanticConfiguration?.enabled && (
                    <div className="space-y-3 pt-3 border-t">
                      <div className="space-y-2">
                        <Label htmlFor={`${idPrefix}-semantic-config-name`}>Configuration Name</Label>
                        <Input
                          id={`${idPrefix}-semantic-config-name`}
                          placeholder="semantic-config"
                          value={formData.search.semanticConfiguration?.configName ?? 'semantic-config'}
                          onChange={(e) => 
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                semanticConfiguration: {
                                  ...prev.search.semanticConfiguration!,
                                  configName: e.target.value
                                }
                              }
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`${idPrefix}-prioritize-title`} className="cursor-pointer">
                          Prioritize Document Titles
                        </Label>
                        <Switch
                          id={`${idPrefix}-prioritize-title`}
                          checked={formData.search.semanticConfiguration?.prioritizeTitle ?? true}
                          onCheckedChange={(prioritizeTitle) =>
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                semanticConfiguration: {
                                  ...prev.search.semanticConfiguration!,
                                  prioritizeTitle
                                }
                              }
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`${idPrefix}-prioritize-keywords`} className="cursor-pointer">
                          Prioritize Metadata Keywords
                        </Label>
                        <Switch
                          id={`${idPrefix}-prioritize-keywords`}
                          checked={formData.search.semanticConfiguration?.prioritizeKeywords ?? true}
                          onCheckedChange={(prioritizeKeywords) => 
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                semanticConfiguration: {
                                  ...prev.search.semanticConfiguration!,
                                  prioritizeKeywords
                                }
                              }
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Lightning size={18} className="text-primary" />
                      <h4 className="font-medium">Vector Compression</h4>
                    </div>
                    <Switch
                      checked={formData.search.vectorCompression?.enabled ?? false}
                      onCheckedChange={(enabled) => 
                        setFormData(prev => ({
                          ...prev,
                          search: {
                            ...prev.search,
                            vectorCompression: {
                              ...prev.search.vectorCompression!,
                              enabled
                            }
                          }
                        }))
                      }
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Reduce storage and improve query performance with vector quantization
                  </p>
                  {formData.search.vectorCompression?.enabled && (
                    <div className="space-y-2 pt-3 border-t">
                      <Label htmlFor={`${idPrefix}-compression-method`}>Compression Method</Label>
                      <Select
                        value={formData.search.vectorCompression?.method ?? 'scalar'}
                        onValueChange={(method: 'scalar' | 'binary') =>
                          setFormData(prev => ({
                            ...prev,
                            search: {
                              ...prev.search,
                              vectorCompression: {
                                ...prev.search.vectorCompression!,
                                method
                              }
                            }
                          }))
                        }
                      >
                        <SelectTrigger id={`${idPrefix}-compression-method`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="scalar">Scalar Quantization (Recommended)</SelectItem>
                          <SelectItem value="binary">Binary Quantization (Maximum Speed)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Scalar: Better quality, moderate speedup • Binary: Lower quality, maximum speedup
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h4 className="font-medium">Custom Scoring Profile</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Boost relevance based on recency, content length, and metadata
                      </p>
                    </div>
                    <Switch
                      checked={formData.search.customScoring?.enabled ?? true}
                      onCheckedChange={(enabled) => 
                        setFormData(prev => ({
                          ...prev,
                          search: {
                            ...prev.search,
                            customScoring: {
                              ...prev.search.customScoring!,
                              enabled
                            }
                          }
                        }))
                      }
                    />
                  </div>
                  {formData.search.customScoring?.enabled && (
                    <div className="space-y-4 pt-3 border-t">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Recency Boost</Label>
                          <span className="text-sm text-muted-foreground">
                            {formData.search.customScoring?.recencyWeight?.toFixed(1) ?? '2.0'}x
                          </span>
                        </div>
                        <Slider
                          value={[formData.search.customScoring?.recencyWeight ?? 2.0]}
                          onValueChange={([recencyWeight]) => 
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                customScoring: {
                                  ...prev.search.customScoring!,
                                  recencyWeight
                                }
                              }
                            }))
                          }
                          min={0}
                          max={5}
                          step={0.1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Prioritize recently created documents
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Content Length Boost</Label>
                          <span className="text-sm text-muted-foreground">
                            {formData.search.customScoring?.lengthWeight?.toFixed(1) ?? '1.5'}x
                          </span>
                        </div>
                        <Slider
                          value={[formData.search.customScoring?.lengthWeight ?? 1.5]}
                          onValueChange={([lengthWeight]) => 
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                customScoring: {
                                  ...prev.search.customScoring!,
                                  lengthWeight
                                }
                              }
                            }))
                          }
                          min={0}
                          max={5}
                          step={0.1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Favor chunks with optimal content length (100-2000 chars)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Metadata Weight</Label>
                          <span className="text-sm text-muted-foreground">
                            {formData.search.customScoring?.metadataWeight?.toFixed(1) ?? '0.3'}x
                          </span>
                        </div>
                        <Slider
                          value={[formData.search.customScoring?.metadataWeight ?? 0.3]}
                          onValueChange={([metadataWeight]) => 
                            setFormData(prev => ({
                              ...prev,
                              search: {
                                ...prev.search,
                                customScoring: {
                                  ...prev.search.customScoring!,
                                  metadataWeight
                                }
                              }
                            }))
                          }
                          min={0}
                          max={2}
                          step={0.1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Weight given to metadata field matches
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <Alert>
                  <Sparkle size={16} />
                  <AlertDescription className="text-sm">
                    <strong>Embedding Quality Optimization:</strong> These settings enhance retrieval accuracy through semantic understanding, vector compression for performance, and custom scoring to prioritize relevant results.
                  </AlertDescription>
                </Alert>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={testConnection}
              disabled={!isFormValid() || testing}
              variant="outline"
              className="flex-1"
            >
              {testing ? (
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2" />
              ) : (
                <TestTube className="mr-2" size={16} />
              )}
              Test Connection
            </Button>
            <Button
              onClick={saveConfiguration}
              disabled={!isFormValid() || testing}
              className="flex-1"
            >
              <CloudCheck className="mr-2" size={16} />
              Save Configuration
            </Button>
          </div>

          <div className="mt-4 p-4 border rounded-lg bg-muted/40 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkle size={16} className="text-primary" />
                  <h4 className="font-medium">Index Maintenance</h4>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Drop and recreate the Azure AI Search index when switching embedding models or vector dimensions.
                </p>
              </div>
              <Button
                onClick={rebuildIndex}
                disabled={!searchConfigReady || rebuildingIndex}
                variant="outline"
              >
                {rebuildingIndex ? (
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2" />
                ) : (
                  <Sparkle className="mr-2" size={16} />
                )}
                Rebuild Index
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Target vector dimensions: {effectiveVectorDimensions}. Update the value above before rebuilding if your embedding model changes.
            </p>
            {rebuildResult && (
              <Alert variant={rebuildResult.type === 'success' ? 'default' : 'destructive'}>
                <AlertDescription className="text-sm">
                  {rebuildResult.message}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <Alert className="mt-4">
            <AlertDescription className="text-sm">
              Your API keys are stored securely in your browser and never sent to external servers except for Azure API calls.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
