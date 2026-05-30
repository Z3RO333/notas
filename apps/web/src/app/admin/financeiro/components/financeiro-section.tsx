import { ClipboardList, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type {
  FinanceiroEvolucaoMes,
  FinanceiroKpiSummary,
  FinanceiroRankingRow,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'
import { FinanceiroCostByUnitChart, FinanceiroMonthlyChart } from './charts-lazy'
import { FinanceiroKpiStrip } from './financeiro-kpi-strip'
import { FinanceiroRankingTable } from './financeiro-ranking-table'

interface FinanceiroSectionProps {
  tipoOrdem: FinanceiroTipoOrdem
  summary: FinanceiroKpiSummary
  evolucao: FinanceiroEvolucaoMes[]
  unidades: FinanceiroRankingRow[]
  servicos: FinanceiroRankingRow[]
  fornecedores: FinanceiroRankingRow[]
}

const SECTION_CONFIG: Record<FinanceiroTipoOrdem, {
  label: string
  sublabel: string
  color: string
  line: string
}> = {
  PMOS: {
    label: 'PMOS',
    sublabel: 'Custos operacionais e corretivos por ordem',
    color: 'text-emerald-500',
    line: 'bg-emerald-500/40',
  },
  PMPL: {
    label: 'PMPL',
    sublabel: 'Custos planejados e preventivos por ordem',
    color: 'text-sky-500',
    line: 'bg-sky-500/40',
  },
}

export function FinanceiroSection({
  tipoOrdem,
  summary,
  evolucao,
  unidades,
  servicos,
  fornecedores,
}: FinanceiroSectionProps) {
  const config = SECTION_CONFIG[tipoOrdem]
  const Icon = tipoOrdem === 'PMOS' ? Wallet : ClipboardList

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 shrink-0 ${config.color}`} />
        <h2 className={`text-base font-semibold ${config.color}`}>{config.label}</h2>
        <span className="text-xs text-muted-foreground">{config.sublabel}</span>
        <div className={`h-px flex-1 ${config.line}`} />
      </div>

      <FinanceiroKpiStrip summary={summary} />

      {summary.total_ordens === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma ordem financeira encontrada para {config.label} no periodo selecionado.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <FinanceiroMonthlyChart data={evolucao} />
            <FinanceiroCostByUnitChart data={unidades} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <FinanceiroRankingTable
              title="Serviços com Maior Custo"
              itemLabel="Serviço"
              data={servicos}
            />
            <FinanceiroRankingTable
              title="Fornecedores com Maior Custo"
              itemLabel="Fornecedor"
              data={fornecedores}
            />
          </div>
        </>
      )}
    </section>
  )
}
