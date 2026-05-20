import { Banknote, Clock3, PieChart, Wallet } from 'lucide-react'
import { CockpitKpiStrip, type CockpitKpiItem } from '@/components/cockpit/cockpit-kpi-strip'
import type { FinanceiroKpiSummary } from '@/lib/types/database'
import { formatCurrencyBRL, formatPercent } from '../financeiro-format'

interface FinanceiroKpiStripProps {
  summary: FinanceiroKpiSummary
}

const KPI_CONFIG = [
  {
    key: 'custo_realizado',
    label: 'Realizado',
    icon: Wallet,
  },
  {
    key: 'custo_previsto_pendente',
    label: 'Previsto pendente',
    icon: Clock3,
  },
  {
    key: 'ticket_medio_realizado',
    label: 'Ticket medio',
    icon: Banknote,
  },
  {
    key: 'cobertura_percentual',
    label: 'Cobertura',
    icon: PieChart,
  },
] as const

export function FinanceiroKpiStrip({ summary }: FinanceiroKpiStripProps) {
  const items: CockpitKpiItem[] = KPI_CONFIG.map((item) => ({
    id: item.key,
    label: item.label,
    value: item.key === 'cobertura_percentual'
      ? formatPercent(summary.cobertura_percentual)
      : formatCurrencyBRL(summary[item.key]),
    helper: item.key === 'cobertura_percentual'
      ? `${summary.ordens_com_custo_real.toLocaleString('pt-BR')} de ${summary.total_ordens.toLocaleString('pt-BR')} ordens`
      : item.key === 'ticket_medio_realizado'
        ? `${summary.ordens_com_custo_real.toLocaleString('pt-BR')} com custo real`
        : `${summary.total_ordens.toLocaleString('pt-BR')} ordens no periodo`,
    icon: item.icon,
    tone: item.key === 'custo_previsto_pendente' && summary.custo_previsto_pendente > 0 ? 'attention' : 'neutral',
  }))

  return <CockpitKpiStrip items={items} columnsClassName="md:grid-cols-2 xl:grid-cols-4" />
}
