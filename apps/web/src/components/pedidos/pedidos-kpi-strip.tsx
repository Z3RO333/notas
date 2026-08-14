'use client'

import { AlertTriangle, CheckCircle2, Clock3, ListChecks, TrendingUp, UserRoundX } from 'lucide-react'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import type { PedidoCompraStatusEfetivo, PedidosKpis } from '@/lib/types/pedidos'

interface PedidosKpiStripProps {
  kpis: PedidosKpis
  loading?: boolean
  activeStatus?: PedidoCompraStatusEfetivo | 'all'
  onStatusChange?: (status: PedidoCompraStatusEfetivo | 'all') => void
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

export function PedidosKpiStrip({
  kpis,
  loading = false,
  activeStatus = 'all',
  onStatusChange,
}: PedidosKpiStripProps) {
  const setStatus = (status: PedidoCompraStatusEfetivo | 'all') => (
    onStatusChange ? () => onStatusChange(activeStatus === status ? 'all' : status) : undefined
  )
  const items: CockpitKpiItem[] = [
    {
      id: 'total',
      label: 'Pedidos no grupo 112',
      value: fmtCount(kpis.total),
      icon: ListChecks,
      active: activeStatus === 'all',
      onClick: setStatus('all'),
    },
    {
      id: 'em_aberto',
      label: 'Em aberto',
      value: fmtCount(kpis.em_aberto),
      helper: `${fmtCurrency(kpis.valor_em_aberto ?? 0)} em aberto`,
      icon: Clock3,
      tone: 'attention',
      active: activeStatus === 'em_aberto',
      onClick: setStatus('em_aberto'),
    },
    {
      id: 'encerrado',
      label: 'Encerrados',
      value: fmtCount(kpis.encerrado),
      icon: CheckCircle2,
      tone: 'success',
      active: activeStatus === 'encerrado',
      onClick: setStatus('encerrado'),
    },
    {
      id: 'aging',
      label: 'Abertos há mais de 90 dias',
      value: fmtCount(kpis.abertos_mais_90_dias ?? 0),
      helper: 'Idade pela data do documento',
      icon: TrendingUp,
      tone: (kpis.abertos_mais_90_dias ?? 0) > 0 ? 'critical' : 'neutral',
    },
    {
      id: 'sem_responsavel',
      label: 'Sem responsável',
      value: fmtCount(kpis.sem_responsavel ?? 0),
      helper: 'Exigem atribuição',
      icon: UserRoundX,
      tone: (kpis.sem_responsavel ?? 0) > 0 ? 'critical' : 'neutral',
    },
    {
      id: 'indeterminado',
      label: 'Status a revisar',
      value: fmtCount(kpis.status_indeterminado ?? kpis.indeterminado ?? 0),
      helper: `${fmtCurrency(kpis.valor_total)} no recorte`,
      icon: AlertTriangle,
      tone: (kpis.status_indeterminado ?? kpis.indeterminado ?? 0) > 0 ? 'critical' : 'neutral',
      active: activeStatus === 'indeterminado',
      onClick: setStatus('indeterminado'),
    },
  ]

  return (
    <CockpitKpiStrip
      items={items}
      loading={loading}
      columnsClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    />
  )
}
