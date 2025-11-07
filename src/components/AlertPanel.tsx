import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Bell, X, CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react'
import { useStorage } from '@/hooks/use-kv'

interface SystemAlert {
  id: string
  severity: 'warning' | 'error'
  code: string
  agent?: string
  message: string
  timestamp: string
  acknowledged: boolean
}

export function AlertPanel() {
  const [alerts, setAlerts] = useStorage<SystemAlert[]>('system-alerts', [])
  const [autoRefresh] = useState(true)

  useEffect(() => {
    if (!autoRefresh || !alerts) return

    // Auto-remove acknowledged alerts after 1 hour
    const cleanupInterval = setInterval(() => {
      const oneHourAgo = Date.now() - 3600000
      setAlerts((alerts || []).filter(alert =>
        !alert.acknowledged || new Date(alert.timestamp).getTime() > oneHourAgo
      ))
    }, 60000) // Check every minute

    return () => clearInterval(cleanupInterval)
  }, [alerts, autoRefresh, setAlerts])

  const alertList = alerts || []
  const unacknowledged = alertList.filter(a => !a.acknowledged)
  const recentAlerts = [...alertList]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)

  const acknowledgeAlert = (id: string) => {
    setAlerts(alertList.map(a =>
      a.id === id ? { ...a, acknowledged: true } : a
    ))
  }

  const dismissAlert = (id: string) => {
    setAlerts(alertList.filter(a => a.id !== id))
  }

  const acknowledgeAll = () => {
    setAlerts(alertList.map(a => ({ ...a, acknowledged: true })))
  }

  const clearAll = () => {
    setAlerts([])
  }

  const getAlertVariant = (severity: 'warning' | 'error') => {
    return severity === 'error' ? 'destructive' : 'default'
  }

  const getAlertIcon = (severity: 'warning' | 'error') => {
    return severity === 'error' ? (
      <XCircle size={16} className="text-status-error" weight="fill" />
    ) : (
      <WarningCircle size={16} className="text-status-warning" weight="fill" />
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell size={20} />
            System Alerts
            {unacknowledged.length > 0 && (
              <Badge variant="destructive">{unacknowledged.length}</Badge>
            )}
          </CardTitle>
          {alertList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              {unacknowledged.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={acknowledgeAll}
                  className="w-full sm:w-auto"
                >
                  <CheckCircle size={16} className="mr-2" />
                  Acknowledge All
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="w-full sm:w-auto"
              >
                Clear All
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {alertList.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle size={48} className="mx-auto text-status-success mb-2" />
            <p className="text-sm text-muted-foreground">No alerts</p>
            <p className="text-xs text-muted-foreground mt-1">
              System is operating normally
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentAlerts.map(alert => (
              <Alert
                key={alert.id}
                variant={getAlertVariant(alert.severity)}
                className={alert.acknowledged ? 'opacity-50' : ''}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <AlertTitle className="flex items-center gap-2 mb-1">
                      {getAlertIcon(alert.severity)}
                      <span className="capitalize">{alert.code.replace(/_/g, ' ')}</span>
                      {alert.agent && (
                        <Badge variant="outline" className="text-xs">
                          {alert.agent}
                        </Badge>
                      )}
                      {alert.acknowledged && (
                        <Badge variant="secondary" className="text-xs">
                          Acknowledged
                        </Badge>
                      )}
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      {alert.message}
                    </AlertDescription>
                    <div className="text-xs text-muted-foreground mt-2">
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {!alert.acknowledged && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="h-8 w-8 p-0"
                        title="Acknowledge"
                      >
                        <CheckCircle size={16} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismissAlert(alert.id)}
                      className="h-8 w-8 p-0"
                      title="Dismiss"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </div>
              </Alert>
            ))}

            {alertList.length > 10 && (
              <p className="text-xs text-center text-muted-foreground pt-2">
                Showing 10 most recent alerts of {alertList.length} total
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
