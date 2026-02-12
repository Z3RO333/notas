'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { CopilotAlert, CopilotAlertLevel } from '@/lib/types/copilot'

interface CopilotAlertsPanelProps {
  alerts: CopilotAlert[]
}

const LEVEL_CONFIG: Record<CopilotAlertLevel, {
  icon: typeof AlertOctagon
  border: string
  bg: string
  iconColor: string
}> = {
  critical: {
    icon: AlertOctagon,
    border: 'border-l-red-500',
    bg: 'bg-red-50',
    iconColor: 'text-red-600',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-l-amber-500',
    bg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  info: {
    icon: CheckCircle2,
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
}

export function CopilotAlertsPanel({ alerts }: CopilotAlertsPanelProps) {
  const criticals = alerts.filter((a) => a.level === 'critical')
  const warnings = alerts.filter((a) => a.level === 'warning')
  const infos = alerts.filter((a) => a.level === 'info')
  const sorted = [...criticals, ...warnings, ...infos]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertOctagon className="h-4 w-4" />
          Alertas ({criticals.length > 0 ? `${criticals.length} critico(s)` : 'OK'})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map((alert) => {
            const config = LEVEL_CONFIG[alert.level]
            const Icon = config.icon

            return (
              <div
                key={alert.id}
                className={`rounded-lg border border-l-4 p-3 ${config.border} ${config.bg}`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                    {alert.actionLabel && (
                      <p className="text-xs text-primary font-medium mt-1 cursor-pointer hover:underline">
                        {alert.actionLabel} →
                      </p>
                    )}
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
