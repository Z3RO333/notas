'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, BarChart3, ClipboardCheck, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import { getOrdersKpiValue } from '@/lib/orders/metrics'
import { updateSearchParams } from '@/lib/grid/query'
import type { CriticalityLevel, OrdersKpiFilter, OrdemNotaKpis } from '@/lib/types/database'

interface OrdersKpiStripProps {
  kpis: OrdemNotaKpis
  activeKpi: OrdersKpiFilter | null
  criticality: CriticalityLevel
  interactive?: boolean
  loading?: boolean
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
  loading = false,
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

  const concluidasVal = getOrdersKpiValue(kpis, 'concluidas')
  const atrasadasVal = getOrdersKpiValue(kpis, 'atrasadas')
  const stripTone = criticality === 'critico' ? 'critical' : criticality === 'atencao' ? 'attention' : undefined

  const items: CockpitKpiItem[] = [
    {
      id: 'total',
      kpi: 'total' as const,
      label: 'Total',
      value: fmt(getOrdersKpiValue(kpis, 'total')),
      helper: `${fmt(concluidasVal)} concluida${concluidasVal !== 1 ? 's' : ''}`,
      icon: ListChecks,
    },
    {
      id: 'em_aberto',
      kpi: 'em_aberto' as const,
      label: 'Abertas',
      value: fmt(getOrdersKpiValue(kpis, 'em_aberto')),
      icon: BarChart3,
    },
    {
      id: 'em_execucao',
      kpi: 'em_execucao' as const,
      label: 'Execução',
      value: fmt(getOrdersKpiValue(kpis, 'em_execucao')),
      icon: LoaderCircle,
    },
    {
      id: 'em_avaliacao',
      kpi: 'em_avaliacao' as const,
      label: 'Avaliação',
      value: fmt(getOrdersKpiValue(kpis, 'em_avaliacao')),
      icon: ShieldCheck,
    },
    {
      id: 'avaliadas',
      kpi: 'avaliadas' as const,
      label: 'Avaliadas',
      value: fmt(getOrdersKpiValue(kpis, 'avaliadas')),
      icon: ClipboardCheck,
    },
    {
      id: 'atrasadas',
      kpi: 'atrasadas' as const,
      label: 'Atrasadas',
      value: fmt(atrasadasVal),
      icon: AlertTriangle,
      tone: atrasadasVal > 0 ? 'critical' as const : 'neutral' as const,
    },
  ].map((item) => ({
    ...item,
    active: activeKpi === item.kpi,
    helper: interactive && activeKpi === item.kpi ? 'Clique para limpar' : item.helper,
    onClick: interactive ? () => handleToggle(item.kpi) : undefined,
  }))

  return (
    <CockpitKpiStrip
      items={items}
      loading={loading}
      tone={stripTone}
      columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    />
  )
}
