import { createClient } from '@/lib/supabase/server'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import type {
  ComparativoFinanceiroMes,
  ComparativoFinanceiroResumoAno,
  ComparativoFornecedorMes,
  ComparativoFornecedorResumo,
  ComparativoOrdensMes,
  ComparativoOrdensResumoAno,
} from '@/lib/types/database'
import { formatCurrencyBRL } from '@/app/admin/financeiro/financeiro-format'
import {
  buildFinanceKpis,
  buildOrdersKpis,
  buildSupplierAnnualRows,
  resolveComparativoYears,
  resolveSelectedSupplierRef,
  toNumber,
  type ComparativoTipoOrdemFilter,
} from './comparativos-utils'
import { ComparisonKpiStrip } from './components/comparison-kpi-strip'
import { ComparativosFilters } from './components/comparativos-filters'
import { FinanceComparisonChart } from './components/finance-comparison-chart'
import { OrdersComparisonChart } from './components/orders-comparison-chart'
import { SuppliersComparisonSection } from './components/suppliers-comparison-section'

export const dynamic = 'force-dynamic'

interface ComparativosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

type YearRow = { ano: number | string | null }

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function resolveTipoOrdem(value?: string): ComparativoTipoOrdemFilter {
  if (value === 'PMOS' || value === 'PMPL') return value
  return 'todos'
}

export default async function ComparativosPage({ searchParams }: ComparativosPageProps) {
  const params = (await searchParams) ?? {}
  const supabase = await createClient()
  const tipoOrdem = resolveTipoOrdem(params.tipo_ordem)

  const yearsResult = await supabase.rpc('listar_comparativo_anos')
  if (yearsResult.error) throw yearsResult.error

  const yearPair = resolveComparativoYears({
    rawYears: ((yearsResult.data ?? []) as YearRow[]).map((row) => row.ano),
    anoBaseParam: params.ano_base,
    anoComparadoParam: params.ano_comparado,
  })

  const tipoOrdemRpc = tipoOrdem === 'todos' ? null : tipoOrdem

  const [
    ordensMensalResult,
    ordensAnualResult,
    financeiroMensalResult,
    financeiroAnualResult,
    fornecedoresAnualResult,
  ] = await Promise.all([
    supabase.rpc('calcular_comparativo_ordens_mensal', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
    }),
    supabase.rpc('calcular_comparativo_ordens_anual', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
    }),
    supabase.rpc('calcular_comparativo_financeiro_mensal', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
    }),
    supabase.rpc('calcular_comparativo_financeiro_anual', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
    }),
    supabase.rpc('calcular_comparativo_financeiro_fornecedores_anual', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
    }),
  ])

  const firstError = [
    ordensMensalResult.error,
    ordensAnualResult.error,
    financeiroMensalResult.error,
    financeiroAnualResult.error,
    fornecedoresAnualResult.error,
  ].find(Boolean)
  if (firstError) throw firstError

  const ordensMensal = ((ordensMensalResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ano: toNumber(row.ano),
    mes: toNumber(row.mes),
    total_ordens: toNumber(row.total_ordens),
    ordens_abertas: toNumber(row.ordens_abertas),
    ordens_executadas: toNumber(row.ordens_executadas),
  })) as ComparativoOrdensMes[]

  const ordensAnual = ((ordensAnualResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ano: toNumber(row.ano),
    total_ordens: toNumber(row.total_ordens),
    ordens_abertas: toNumber(row.ordens_abertas),
    ordens_executadas: toNumber(row.ordens_executadas),
  })) as ComparativoOrdensResumoAno[]

  const financeiroMensal = ((financeiroMensalResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ano: toNumber(row.ano),
    mes: toNumber(row.mes),
    total_ordens: toNumber(row.total_ordens),
    total_gasto: toNumber(row.total_gasto),
    valor_realizado: toNumber(row.valor_realizado),
    valor_previsto_pendente: toNumber(row.valor_previsto_pendente),
  })) as ComparativoFinanceiroMes[]

  const financeiroAnual = ((financeiroAnualResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ano: toNumber(row.ano),
    total_ordens: toNumber(row.total_ordens),
    total_gasto: toNumber(row.total_gasto),
    valor_realizado: toNumber(row.valor_realizado),
    valor_previsto_pendente: toNumber(row.valor_previsto_pendente),
  })) as ComparativoFinanceiroResumoAno[]

  const fornecedoresAnual = ((fornecedoresAnualResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    fornecedor_ref: String(row.fornecedor_ref ?? ''),
    fornecedor_codigo: typeof row.fornecedor_codigo === 'string' ? row.fornecedor_codigo : null,
    fornecedor_nome: typeof row.fornecedor_nome === 'string' ? row.fornecedor_nome : null,
    ano: toNumber(row.ano),
    total_ordens: toNumber(row.total_ordens),
    total_gasto: toNumber(row.total_gasto),
    valor_realizado: toNumber(row.valor_realizado),
    valor_previsto_pendente: toNumber(row.valor_previsto_pendente),
  })) as ComparativoFornecedorResumo[]

  const supplierAnnualRows = buildSupplierAnnualRows(
    fornecedoresAnual,
    yearPair.anoBase,
    yearPair.anoComparado,
  )
  const selectedSupplierRef = resolveSelectedSupplierRef(
    supplierAnnualRows,
    params.fornecedor ?? null,
  )

  const fornecedorMensalResult = selectedSupplierRef
    ? await supabase.rpc('calcular_comparativo_financeiro_fornecedor_mensal', {
      p_ano_base: yearPair.anoBase,
      p_ano_comparado: yearPair.anoComparado,
      p_tipo_ordem: tipoOrdemRpc,
      p_fornecedor_codigo: selectedSupplierRef,
    })
    : { data: [], error: null }

  if (fornecedorMensalResult.error) throw fornecedorMensalResult.error

  const fornecedorMensal = ((fornecedorMensalResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    fornecedor_ref: String(row.fornecedor_ref ?? ''),
    fornecedor_codigo: typeof row.fornecedor_codigo === 'string' ? row.fornecedor_codigo : null,
    fornecedor_nome: typeof row.fornecedor_nome === 'string' ? row.fornecedor_nome : null,
    ano: toNumber(row.ano),
    mes: toNumber(row.mes),
    total_ordens: toNumber(row.total_ordens),
    total_gasto: toNumber(row.total_gasto),
    valor_realizado: toNumber(row.valor_realizado),
    valor_previsto_pendente: toNumber(row.valor_previsto_pendente),
  })) as ComparativoFornecedorMes[]

  const ordersKpis = buildOrdersKpis(ordensAnual, yearPair.anoBase, yearPair.anoComparado)
  const financeKpis = buildFinanceKpis(financeiroAnual, yearPair.anoBase, yearPair.anoComparado)

  return (
    <div className="space-y-8">
      <PageTitleBlock title="Comparativos anuais" subtitle="Ordens, custos e fornecedores entre dois anos." />

      <ComparativosFilters
        anos={yearPair.availableYears}
        anoBase={yearPair.anoBase}
        anoComparado={yearPair.anoComparado}
        tipoOrdem={tipoOrdem}
      />

      <ChartLabelsProvider>
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Ordens</h2>
            <p className="text-sm text-muted-foreground">
              Volume anual e variação mensal de ordens abertas e executadas.
            </p>
          </div>
          <ComparisonKpiStrip items={ordersKpis} formatValue={formatInteger} />
          <OrdersComparisonChart
            rows={ordensMensal}
            anoBase={yearPair.anoBase}
            anoComparado={yearPair.anoComparado}
          />
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Financeiro</h2>
            <p className="text-sm text-muted-foreground">
              A pagina mostra, lado a lado, gasto realizado, compromisso total e valor pendente dos dois anos selecionados.
            </p>
          </div>
          <ComparisonKpiStrip items={financeKpis} formatValue={formatCurrencyBRL} />
          <FinanceComparisonChart
            rows={financeiroMensal}
            anoBase={yearPair.anoBase}
            anoComparado={yearPair.anoComparado}
          />
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Fornecedores</h2>
            <p className="text-sm text-muted-foreground">
              Ranking anual de fornecedores.
            </p>
          </div>
          <SuppliersComparisonSection
            annualRows={supplierAnnualRows}
            monthlyRows={fornecedorMensal}
            selectedSupplierRef={selectedSupplierRef}
            anoBase={yearPair.anoBase}
            anoComparado={yearPair.anoComparado}
          />
        </section>
      </ChartLabelsProvider>
    </div>
  )
}
