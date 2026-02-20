import { AlertOctagon, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'
import type { ComponentType } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SyncLog } from '@/lib/types/database'
import type { DashboardAlert } from '@/lib/types/dashboard'

interface AlertsPanelProps {
  alerts: DashboardAlert[]
  latestSync: SyncLog | null
}

function formatSyncDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function getStatusPill(status: string): string {
  if (status === 'success') return 'bg-green-100 text-green-700'
  if (status === 'error') return 'bg-red-100 text-red-700'
  return 'bg-yellow-100 text-yellow-700'
}

function getAlertStyles(level: DashboardAlert['level']): {
  icon: ComponentType<{ className?: string }>
  wrapper: string
} {
  if (level === 'critical') {
    return {
      icon: AlertOctagon,
      wrapper: 'border-red-200 bg-red-50/70',
    }
  }
  if (level === 'warning') {
    return {
      icon: AlertTriangle,
      wrapper: 'border-amber-200 bg-amber-50/70',
    }
  }
  return {
    icon: CheckCircle2,
    wrapper: 'border-green-200 bg-green-50/70',
  }
}

export function AlertsPanel({ alerts, latestSync }: AlertsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Alertas e saude operacional</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Ultimo sync
            </div>
            {latestSync ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatSyncDate(latestSync.started_at)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusPill(latestSync.status)}`}>
                  {latestSync.status}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Não encontrado</span>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {alerts.map((alert) => {
            const style = getAlertStyles(alert.level)
            const Icon = style.icon
            return (
              <div key={alert.id} className={`rounded-lg border p-3 ${style.wrapper}`}>
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{alert.title}</p>
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
