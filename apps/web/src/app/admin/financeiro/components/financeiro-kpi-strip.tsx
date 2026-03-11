import { Banknote, Clock3, PieChart, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { FinanceiroKpiSummary } from '@/lib/types/database'
import { formatCurrencyBRL, formatPercent } from '../financeiro-format'

interface FinanceiroKpiStripProps {
  summary: FinanceiroKpiSummary
}

const KPI_CONFIG = [
  {
    key: 'custo_realizado',
    label: 'Custo Realizado',
    color: 'text-emerald-500',
    icon: Wallet,
  },
  {
    key: 'custo_previsto_pendente',
    label: 'Custo Previsto Pendente',
    color: 'text-amber-500',
    icon: Clock3,
  },
  {
    key: 'ticket_medio_realizado',
    label: 'Ticket Medio Realizado',
    color: 'text-sky-500',
    icon: Banknote,
  },
  {
    key: 'cobertura_percentual',
    label: 'Cobertura Financeira',
    color: 'text-violet-500',
    icon: PieChart,
  },
] as const

export function FinanceiroKpiStrip({ summary }: FinanceiroKpiStripProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {KPI_CONFIG.map((item) => {
        const Icon = item.icon
        const value = item.key === 'cobertura_percentual'
          ? formatPercent(summary.cobertura_percentual)
          : formatCurrencyBRL(summary[item.key])

        const helperText = item.key === 'cobertura_percentual'
          ? `${summary.ordens_com_custo_real.toLocaleString('pt-BR')} de ${summary.total_ordens.toLocaleString('pt-BR')} ordens com custo`
          : item.key === 'ticket_medio_realizado'
            ? `${summary.ordens_com_custo_real.toLocaleString('pt-BR')} ordens com custo real`
            : `${summary.total_ordens.toLocaleString('pt-BR')} ordens no periodo`

        return (
          <Card key={item.key}>
            <CardContent className="pt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                <Icon className={`h-4 w-4 ${item.color}`} />
              </div>
              <p className={`text-2xl font-bold ${item.color}`}>{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
