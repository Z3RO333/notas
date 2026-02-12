import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
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
  concluidas_30d: CheckCircle2,
  taxa_fechamento_30d: Percent,
  utilizacao_capacidade: Gauge,
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
          <Card key={item.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
              <Icon className={`h-4 w-4 ${tone.icon}`} />
            </CardHeader>
            <CardContent className="space-y-1">
              <div className={`text-3xl font-bold ${tone.value}`}>{item.value}</div>
              <p className="text-xs text-muted-foreground">{item.helper}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
