import { createAdminClient } from '@/lib/supabase/admin'
import type {
  FinanceiroEvolucaoMes,
  FinanceiroKpiSummary,
  FinanceiroRankingRow,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'
import { FinanceiroFilters } from './components/financeiro-filters'
import { FinanceiroImportDialog } from './components/financeiro-import-dialog'
import { FinanceiroSection } from './components/financeiro-section'
import { CartaoImportDialog } from './components/cartao-import-dialog'
import { CartaoKpiStrip } from './components/cartao-kpi-strip'
import { CartaoMonthlyChart } from './components/charts-lazy'
import { CartaoRankingFornecedores } from './components/cartao-ranking-fornecedores'
import { CartaoRankingCentros } from './components/cartao-ranking-centros'
import type { CartaoKpiData } from './components/cartao-kpi-strip'
import type { CartaoMesData } from './components/cartao-monthly-chart'
import type { CartaoRankingRow } from './components/cartao-ranking-fornecedores'
import { FINANCEIRO_MONTH_LABELS } from './financeiro-format'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { toNumber } from './financeiro-data'

export const dynamic = 'force-dynamic'

const TIPOS: FinanceiroTipoOrdem[] = ['PMOS', 'PMPL']

interface FinanceiroPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

type FinanceiroAggregatedTipo = {
  summary?: Partial<FinanceiroKpiSummary>
  evolucao?: Array<Partial<FinanceiroEvolucaoMes>>
  unidades?: Array<Partial<FinanceiroRankingRow>>
  servicos?: Array<Partial<FinanceiroRankingRow>>
  fornecedores?: Array<Partial<FinanceiroRankingRow>>
}

type FinanceiroAggregatedPayload = {
  yearOptions?: unknown[]
  tipos?: Partial<Record<FinanceiroTipoOrdem, FinanceiroAggregatedTipo>>
}

type CartaoAggregatedPayload = {
  yearOptions?: unknown[]
  kpi?: Partial<CartaoKpiData>
  mensal?: Array<Partial<CartaoMesData>>
  fornecedores?: Array<Partial<CartaoRankingRow>>
  centros?: Array<Partial<CartaoRankingRow>>
}

function toYearOptions(...sources: Array<unknown[] | undefined>) {
  const currentYear = new Date().getFullYear()
  const years = new Set<number>([currentYear])
  for (const source of sources) {
    for (const value of source ?? []) {
      const year = toNumber(value)
      if (year > 0) years.add(year)
    }
  }
  return Array.from(years).sort((left, right) => right - left)
}

function mapFinanceiroSummary(tipo: FinanceiroTipoOrdem, value: Partial<FinanceiroKpiSummary> | undefined): FinanceiroKpiSummary {
  return {
    tipo_ordem: tipo,
    total_ordens: toNumber(value?.total_ordens),
    ordens_com_custo_real: toNumber(value?.ordens_com_custo_real),
    custo_realizado: toNumber(value?.custo_realizado),
    custo_previsto_pendente: toNumber(value?.custo_previsto_pendente),
    ticket_medio_realizado: toNumber(value?.ticket_medio_realizado),
    cobertura_percentual: toNumber(value?.cobertura_percentual),
  }
}

function mapFinanceiroEvolucao(rows: Array<Partial<FinanceiroEvolucaoMes>> | undefined): FinanceiroEvolucaoMes[] {
  return (rows ?? []).map((row) => {
    const ano = toNumber(row.ano)
    const mes = toNumber(row.mes)
    const realizado = toNumber(row.realizado)
    const previsto = toNumber(row.previsto_pendente)
    return {
      ano,
      mes,
      label: `${FINANCEIRO_MONTH_LABELS[mes] ?? mes}/${String(ano).slice(2)}`,
      realizado,
      previsto_pendente: previsto,
      total_gasto: toNumber(row.total_gasto) || realizado,
      compromisso_total: toNumber(row.compromisso_total) || realizado + previsto,
    }
  })
}

function mapFinanceiroRanking(rows: Array<Partial<FinanceiroRankingRow>> | undefined): FinanceiroRankingRow[] {
  return (rows ?? []).map((row) => {
    const realizado = toNumber(row.realizado)
    const previsto = toNumber(row.previsto_pendente)
    return {
      nome: String(row.nome ?? 'Sem classificacao'),
      realizado,
      previsto_pendente: previsto,
      total_gasto: toNumber(row.total_gasto) || realizado,
      compromisso_total: toNumber(row.compromisso_total) || realizado + previsto,
    }
  })
}

function mapCartaoMensal(rows: Array<Partial<CartaoMesData>> | undefined): CartaoMesData[] {
  return (rows ?? []).map((row) => {
    const ano = toNumber(row.ano)
    const mes = toNumber(row.mes)
    return {
      ano,
      mes,
      label: `${FINANCEIRO_MONTH_LABELS[mes] ?? mes}/${String(ano).slice(2)}`,
      total: toNumber(row.total),
      qtd: toNumber(row.qtd),
    }
  })
}

function mapCartaoRanking(rows: Array<Partial<CartaoRankingRow>> | undefined): CartaoRankingRow[] {
  return (rows ?? []).map((row) => ({
    nome: String(row.nome ?? 'Sem classificacao'),
    total: toNumber(row.total),
    qtd: toNumber(row.qtd),
  }))
}

export default async function FinanceiroPage({ searchParams }: FinanceiroPageProps) {
  const params = (await searchParams) ?? {}
  const currentYear = new Date().getFullYear()
  const parsedAno = params.ano && params.ano !== 'todos' ? parseInt(params.ano, 10) : NaN
  const parsedMes = params.mes && params.mes !== 'todos' ? parseInt(params.mes, 10) : NaN
  const ano = params.ano === 'todos'
    ? undefined
    : (Number.isFinite(parsedAno) ? parsedAno : currentYear)
  const mes = Number.isFinite(parsedMes) ? parsedMes : undefined

  const supabase = createAdminClient()

  const [financeiroResult, cartaoResult] = await Promise.all([
    supabase.rpc('buscar_financeiro_dashboard_agregado', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
    }),
    supabase.rpc('buscar_cartao_dashboard_agregado', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
    }),
  ])

  if (financeiroResult.error) throw financeiroResult.error
  if (cartaoResult.error) throw cartaoResult.error

  const financeiroPayload = (financeiroResult.data ?? {}) as FinanceiroAggregatedPayload
  const cartaoPayload = (cartaoResult.data ?? {}) as CartaoAggregatedPayload
  const yearOptions = toYearOptions(financeiroPayload.yearOptions, cartaoPayload.yearOptions)

  const byTipo = Object.fromEntries(
    TIPOS.map((tipo) => {
      const aggregated = financeiroPayload.tipos?.[tipo] ?? {}
      return [tipo, {
        summary: mapFinanceiroSummary(tipo, aggregated.summary),
        evolucao: mapFinanceiroEvolucao(aggregated.evolucao),
        unidades: mapFinanceiroRanking(aggregated.unidades),
        servicos: mapFinanceiroRanking(aggregated.servicos),
        fornecedores: mapFinanceiroRanking(aggregated.fornecedores),
      }]
    })
  ) as Record<FinanceiroTipoOrdem, {
    summary: FinanceiroKpiSummary
    evolucao: FinanceiroEvolucaoMes[]
    unidades: FinanceiroRankingRow[]
    servicos: FinanceiroRankingRow[]
    fornecedores: FinanceiroRankingRow[]
  }>

  const cartaoKpi: CartaoKpiData = {
    total_gasto: toNumber(cartaoPayload.kpi?.total_gasto),
    qtd_transacoes: toNumber(cartaoPayload.kpi?.qtd_transacoes),
    ticket_medio: toNumber(cartaoPayload.kpi?.ticket_medio),
  }
  const cartaoMensal = mapCartaoMensal(cartaoPayload.mensal)
  const cartaoFornecedores = mapCartaoRanking(cartaoPayload.fornecedores)
  const cartaoCentros = mapCartaoRanking(cartaoPayload.centros)
  const hasCartaoData = cartaoKpi.qtd_transacoes > 0

  const hasImportedData = yearOptions.length > 0

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Financeiro"
        subtitle="Custos por ordem, serviço e fornecedor."
        rightSlot={
          <div className="flex gap-2">
            <CartaoImportDialog />
            <FinanceiroImportDialog />
          </div>
        }
      />

      <FinanceiroFilters
        anos={yearOptions}
        anoAtivo={ano}
        mesAtivo={mes}
      />

      {!hasImportedData ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm font-medium">Nenhuma base financeira importada ainda.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Use o botão de importação para carregar a planilha SAP financeira.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {TIPOS.map((tipo) => (
            <FinanceiroSection
              key={tipo}
              tipoOrdem={tipo}
              summary={byTipo[tipo].summary}
              evolucao={byTipo[tipo].evolucao}
              unidades={byTipo[tipo].unidades}
              servicos={byTipo[tipo].servicos}
              fornecedores={byTipo[tipo].fornecedores}
            />
          ))}
        </div>
      )}

      {/* Seção Cartão Corporativo */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Cartao Corporativo</h2>
            <p className="text-sm text-muted-foreground">
              Gastos do cartao Alelo Despesas, independente das ordens SAP.
            </p>
          </div>
        </div>

        {!hasCartaoData ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm font-medium">Nenhum gasto de cartao importado para o periodo.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Use o botao &quot;Importar Cartao&quot; acima para carregar os dados.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <CartaoKpiStrip data={cartaoKpi} />
            <CartaoMonthlyChart data={cartaoMensal} />
            <div className="grid gap-6 xl:grid-cols-2">
              <CartaoRankingFornecedores data={cartaoFornecedores} />
              <CartaoRankingCentros data={cartaoCentros} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
