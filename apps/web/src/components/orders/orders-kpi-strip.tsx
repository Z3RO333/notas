'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, BarChart3, ClipboardCheck, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrdersKpiValue } from '@/lib/orders/metrics'
import { updateSearchParams } from '@/lib/grid/query'
import type { CriticalityLevel, OrdersKpiFilter, OrdemNotaKpis } from '@/lib/types/database'

interface OrdersKpiStripProps {
  kpis: OrdemNotaKpis
  activeKpi: OrdersKpiFilter | null
  criticality: CriticalityLevel
  interactive?: boolean
}

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function OrdersKpiStrip({
  kpis,
  activeKpi,
  criticality,
  interactive = true,
}: OrdersKpiStripProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleToggle(kpi: OrdersKpiFilter) {
    if (!interactive) return
    const nextKpi = activeKpi === kpi ? null : kpi
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), { kpi: nextKpi })
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  const frameClass = criticality === 'critico'
    ? 'border-red-300 bg-red-50/30'
    : criticality === 'atencao'
      ? 'border-amber-300 bg-amber-50/30'
      : 'border-border'

  const concluidasVal = getOrdersKpiValue(kpis, 'concluidas')

  const cards = [
    {
      id: 'total',
      kpi: 'total' as const,
      label: 'Total de ordens',
      value: fmt(getOrdersKpiValue(kpis, 'total')),
      helper: `${fmt(concluidasVal)} concluída${concluidasVal !== 1 ? 's' : ''}`,
      icon: ListChecks,
      valueClass: 'text-foreground',
    },
    {
      id: 'em_aberto',
      kpi: 'em_aberto' as const,
      label: 'Em processamento',
      value: fmt(getOrdersKpiValue(kpis, 'em_aberto')),
      helper: '',
      icon: BarChart3,
      valueClass: 'text-sky-700',
    },
    {
      id: 'em_execucao',
      kpi: 'em_execucao' as const,
      label: 'Em execução',
      value: fmt(getOrdersKpiValue(kpis, 'em_execucao')),
      helper: '',
      icon: LoaderCircle,
      valueClass: 'text-indigo-700',
    },
    {
      id: 'em_avaliacao',
      kpi: 'em_avaliacao' as const,
      label: 'Em avaliação',
      value: fmt(getOrdersKpiValue(kpis, 'em_avaliacao')),
      helper: '',
      icon: ShieldCheck,
      valueClass: 'text-emerald-700',
    },
    {
      id: 'avaliadas',
      kpi: 'avaliadas' as const,
      label: 'Avaliadas',
      value: fmt(getOrdersKpiValue(kpis, 'avaliadas')),
      helper: '',
      icon: ClipboardCheck,
      valueClass: 'text-amber-700',
    },
    {
      id: 'atrasadas',
      kpi: 'atrasadas' as const,
      label: 'Atrasadas (7+)',
      value: fmt(getOrdersKpiValue(kpis, 'atrasadas')),
      helper: '',
      icon: AlertTriangle,
      valueClass: 'text-red-700',
    },
  ]

  return (
    <div className={`rounded-lg border p-2 ${frameClass}`}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map((item) => {
        const Icon = item.icon
        const active = activeKpi === item.kpi
        return (
          <button
            key={item.id}
            type="button"
            className="h-full text-left disabled:cursor-default"
            onClick={() => handleToggle(item.kpi)}
            disabled={!interactive}
          >
            <Card className={`h-full transition-all hover:shadow-sm ${active ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="min-h-[2.5rem] flex-1 pr-2 text-sm font-medium leading-tight text-muted-foreground">
                {item.label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className={`text-3xl font-bold ${item.valueClass}`}>{item.value}</p>
              <p className="min-h-[2rem] text-xs leading-4 text-muted-foreground">
                {interactive
                  ? (active ? 'KPI ativo. Clique para limpar.' : item.helper)
                  : item.helper}
              </p>
            </CardContent>
            </Card>
          </button>
        )
      })}
      </div>
    </div>
  )
}
