import { CreditCard, Hash, TrendingUp } from 'lucide-react'
import { formatCurrencyBRL } from '../financeiro-format'

export interface CartaoKpiData {
  total_gasto: number
  qtd_transacoes: number
  ticket_medio: number
}

interface CartaoKpiStripProps {
  data: CartaoKpiData
}

export function CartaoKpiStrip({ data }: CartaoKpiStripProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CreditCard className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Total Gasto</span>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight">
          {formatCurrencyBRL(data.total_gasto)}
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Hash className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Transacoes</span>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight">
          {data.qtd_transacoes.toLocaleString('pt-BR')}
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Ticket Medio</span>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight">
          {formatCurrencyBRL(data.ticket_medio)}
        </p>
      </div>
    </div>
  )
}
