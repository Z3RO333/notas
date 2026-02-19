import {
  AlertTriangle,
  Clock3,
  GitMerge,
  Layers3,
  Percent,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardKpiId, DashboardKpiItem, DashboardTone } from '@/lib/types/dashboard'

interface KpiStripProps {
  items: DashboardKpiItem[]
}

const iconByKpi: Record<DashboardKpiId, ComponentType<{ className?: string }>> = {
  abertas_agora: Layers3,
  sem_atribuir: AlertTriangle,
  aging_48h: Clock3,
  taxa_nota_ordem_30d: GitMerge,
  taxa_fechamento_30d: Percent,
}

const toneClasses: Record<DashboardTone, { icon: string; value: string }> = {
  neutral: {
    icon: 'text-slate-600',
    value: 'text-foreground',
  },
  success: {
    icon: 'text-green-600',
    value: 'text-green-700',
  },
  warning: {
    icon: 'text-amber-600',
    value: 'text-amber-700',
  },
  danger: {
    icon: 'text-red-600',
    value: 'text-red-700',
  },
}

export function KpiStrip({ items }: KpiStripProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const Icon = iconByKpi[item.id]
        const tone = toneClasses[item.tone]

        return (
          <Card key={item.id} className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex min-h-[2.5rem] items-start gap-2 text-sm font-medium text-muted-foreground">
                <Icon className={`h-4 w-4 ${tone.icon}`} />
                <span className="leading-tight">{item.label}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className={`text-3xl font-bold ${tone.value}`}>{item.value}</div>
              <p className="min-h-[2rem] text-xs leading-4 text-muted-foreground">{item.helper ?? ''}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
