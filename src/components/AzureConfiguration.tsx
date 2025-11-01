import React, { useState, useEffect } from 'react'
import { useSparkKV } from '@/hooks/use-spark-kv'
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
import { CloudArrowUp, CloudCheck, CloudX, Eye, EyeSlash, TestTube, Sparkle, Lightning } from '@phosphor-icons/react'
import { AzureConfig, AzureConnectionStatus } from '@/types'
import { azureServiceManager } from '@/lib/azure-service-manager'
import { cn } from '@/lib/utils'

export function AzureConfiguration() {
  const [config, setConfig] = useSparkKV<AzureConfig | null>('azure-config', null)
  const [status, setStatus] = useSparkKV<AzureConnectionStatus | null>('azure-status', null)
  const [formData, setFormData] = useState<AzureConfig>({
    openai: {
      endpoint: '',
      apiKey: '',
      deploymentName: '',
      embeddingDeploymentName: '',
      apiVersion: '2024-08-01-preview'
    },
    search: {
      endpoint: '',
      apiKey: '',
      indexName: 'documents',
      apiVersion: '2024-05-01-preview',
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

  useEffect(() => {
    if (config) {
      setFormData(config)
    }
  }, [config])

  const handleInputChange = (service: 'openai' | 'search', field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [service]: {
        ...prev[service],
        [field]: value
      }
    }))
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const newStatus = await azureServiceManager.initialize(formData)
      setStatus(newStatus)
    } catch (error) {
      setStatus({
        openai: 'error',
        search: 'error',
        lastTested: new Date().toISOString(),
        errors: {
          openai: error instanceof Error ? error.message : 'Unknown error',
          search: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    } finally {
      setTesting(false)
    }
  }

  const saveConfiguration = async () => {
    await testConnection()
    setConfig(formData)
  }

  const getStatusIcon = (serviceStatus: string) => {
    switch (serviceStatus) {
      case 'connected':
        return <CloudCheck className="text-green-500" size={16} />
      case 'error':
        return <CloudX className="text-red-500" size={16} />
      case 'testing':
        return <TestTube className="text-blue-500 animate-pulse" size={16} />
      default:
        return <CloudArrowUp className="text-muted-foreground" size={16} />
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
          {status && (
            <div className="mb-6 p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">Connection Status</h4>
                <p className="text-xs text-muted-foreground">
                  Last tested: {new Date(status.lastTested!).toLocaleString()}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                  <Label htmlFor="openai-endpoint">Endpoint URL</Label>
                  <Input
                    id="openai-endpoint"
                    placeholder="https://your-resource.openai.azure.com"
                    value={formData.openai.endpoint}
                    onChange={(e) => handleInputChange('openai', 'endpoint', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai-deployment">Chat Deployment Name</Label>
                  <Input
                    id="openai-deployment"
                    placeholder="gpt-4"
                    value={formData.openai.deploymentName}
                    onChange={(e) => handleInputChange('openai', 'deploymentName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai-embedding-deployment">Embedding Deployment Name</Label>
                  <Input
                    id="openai-embedding-deployment"
                    placeholder="text-embedding-ada-002"
                    value={formData.openai.embeddingDeploymentName}
                    onChange={(e) => handleInputChange('openai', 'embeddingDeploymentName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai-version">API Version</Label>
                  <Input
                    id="openai-version"
                    value={formData.openai.apiVersion}
                    onChange={(e) => handleInputChange('openai', 'apiVersion', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openai-key">API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="openai-key"
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
            </TabsContent>

            <TabsContent value="search" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="search-endpoint">Service URL</Label>
                  <Input
                    id="search-endpoint"
                    placeholder="https://your-service.search.windows.net"
                    value={formData.search.endpoint}
                    onChange={(e) => handleInputChange('search', 'endpoint', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="search-index">Index Name</Label>
                  <Input
                    id="search-index"
                    placeholder="documents"
                    value={formData.search.indexName}
                    onChange={(e) => handleInputChange('search', 'indexName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="search-version">API Version</Label>
                  <Input
                    id="search-version"
                    value={formData.search.apiVersion}
                    onChange={(e) => handleInputChange('search', 'apiVersion', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="search-key">Admin API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="search-key"
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
                        <Label htmlFor="semantic-config-name">Configuration Name</Label>
                        <Input
                          id="semantic-config-name"
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
                        <Label htmlFor="prioritize-title" className="cursor-pointer">
                          Prioritize Document Titles
                        </Label>
                        <Switch
                          id="prioritize-title"
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
                        <Label htmlFor="prioritize-keywords" className="cursor-pointer">
                          Prioritize Metadata Keywords
                        </Label>
                        <Switch
                          id="prioritize-keywords"
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
                      <Label htmlFor="compression-method">Compression Method</Label>
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
                        <SelectTrigger id="compression-method">
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
