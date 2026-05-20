'use client'

import { BarChart3, CheckCircle2, ListChecks, TrendingUp, XCircle } from 'lucide-react'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import type { PedidosKpis } from '@/lib/types/pedidos'

interface PedidosKpiStripProps {
  kpis: PedidosKpis
  loading?: boolean
}

function fmtCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function PedidosKpiStrip({ kpis, loading = false }: PedidosKpiStripProps) {
  const items: CockpitKpiItem[] = [
    {
      id: 'total',
      label: 'Total',
      value: fmtCount(kpis.total),
      icon: ListChecks,
    },
    {
      id: 'em_aberto',
      label: 'Abertos',
      value: fmtCount(kpis.em_aberto),
      icon: BarChart3,
    },
    {
      id: 'encerrado',
      label: 'Encerrados',
      value: fmtCount(kpis.encerrado),
      icon: CheckCircle2,
      tone: 'success',
    },
    {
      id: 'cancelado',
      label: 'Cancelados',
      value: fmtCount(kpis.cancelado),
      icon: XCircle,
      tone: kpis.cancelado > 0 ? 'critical' : 'neutral',
    },
    {
      id: 'valor_total',
      label: 'Valor',
      value: fmtCurrency(kpis.valor_total),
      icon: TrendingUp,
    },
  ]

  return (
    <CockpitKpiStrip
      items={items}
      loading={loading}
      columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
    />
  )
}
