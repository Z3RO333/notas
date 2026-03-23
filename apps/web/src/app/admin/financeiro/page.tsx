import { createClient } from '@/lib/supabase/server'
import type {
  FinanceiroEvolucaoMes,
  FinanceiroKpiSummary,
  FinanceiroOrdemRow,
  FinanceiroRankingRow,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'
import { FinanceiroFilters } from './components/financeiro-filters'
import { FinanceiroImportDialog } from './components/financeiro-import-dialog'
import { FinanceiroSection } from './components/financeiro-section'
import { CartaoImportDialog } from './components/cartao-import-dialog'
import { CartaoKpiStrip } from './components/cartao-kpi-strip'
import { CartaoMonthlyChart } from './components/cartao-monthly-chart'
import { CartaoRankingFornecedores } from './components/cartao-ranking-fornecedores'
import { CartaoRankingCentros } from './components/cartao-ranking-centros'
import type { CartaoKpiData } from './components/cartao-kpi-strip'
import type { CartaoMesData } from './components/cartao-monthly-chart'
import type { CartaoRankingRow } from './components/cartao-ranking-fornecedores'
import { FINANCEIRO_MONTH_LABELS } from './financeiro-format'
import { buildMonthlyEvolution, buildRanking, buildSummary, toNumber } from './financeiro-data'

export const dynamic = 'force-dynamic'

const TIPOS: FinanceiroTipoOrdem[] = ['PMOS', 'PMPL']
const FETCH_PAGE_SIZE = 1000

interface FinanceiroPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

type FetchPageResult = {
  data: unknown[] | null
  error: unknown
}

type CartaoGastoRow = {
  data: string
  fornecedor: string
  centro_custo: string | null
  valor: number
  ano: number
  mes: number
}

function buildCartaoKpi(rows: CartaoGastoRow[]): CartaoKpiData {
  const total = rows.reduce((sum, row) => sum + row.valor, 0)
  return {
    total_gasto: total,
    qtd_transacoes: rows.length,
    ticket_medio: rows.length > 0 ? total / rows.length : 0,
  }
}

function buildCartaoMensal(rows: CartaoGastoRow[]): CartaoMesData[] {
  const grouped = new Map<string, CartaoMesData>()

  for (const row of rows) {
    const key = `${row.ano}-${String(row.mes).padStart(2, '0')}`
    const existing = grouped.get(key)
    if (existing) {
      existing.total += row.valor
      existing.qtd += 1
      continue
    }
    grouped.set(key, {
      ano: row.ano,
      mes: row.mes,
      label: `${FINANCEIRO_MONTH_LABELS[row.mes] ?? row.mes}/${String(row.ano).slice(2)}`,
      total: row.valor,
      qtd: 1,
    })
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row)
}

function buildCartaoRanking(rows: CartaoGastoRow[], resolveKey: (row: CartaoGastoRow) => string, limit: number): CartaoRankingRow[] {
  const grouped = new Map<string, CartaoRankingRow>()

  for (const row of rows) {
    const key = resolveKey(row).trim() || 'Sem classificacao'
    const current = grouped.get(key)
    if (current) {
      current.total += row.valor
      current.qtd += 1
      continue
    }
    grouped.set(key, { nome: key, total: row.valor, qtd: 1 })
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

const PARALLEL_PAGES = 10 // handles up to 10 000 rows per round

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<FetchPageResult>,
  pageSize = FETCH_PAGE_SIZE,
) {
  const rows: T[] = []

  for (let offset = 0; ; offset += PARALLEL_PAGES * pageSize) {
    const results = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, i) => {
        const from = offset + i * pageSize
        return fetchPage(from, from + pageSize - 1)
      }),
    )

    let done = false
    for (const { data, error } of results) {
      if (error) throw error
      const batch = (data ?? []) as T[]
      rows.push(...batch)
      if (batch.length < pageSize) { done = true; break }
    }

    if (done) break
  }

  return rows
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

  const supabase = await createClient()

  const [rows, yearsFromOrdensRaw, yearsFromCartaoRaw, cartaoRows] = await Promise.all([
    fetchAllRows<FinanceiroOrdemRow>((from, to) => {
      let query = supabase
        .from('vw_financeiro_ordens')
        .select([
          'id',
          'ordem_codigo',
          'tipo_ordem',
          'numero_nota',
          'data_entrada',
          'denominacao_unidade',
          'texto_breve',
          'fornecedor_codigo',
          'fornecedor_nome',
          'custos_estimados',
          'custos_totais_materiais',
          'custos_adicionais',
          'custos_totais_reais',
          'competencia_ano',
          'competencia_mes',
          'valor_realizado',
          'valor_previsto_pendente',
          'tem_custo_real',
          'valor_servico_calculado',
          'source_file_name',
          'imported_by',
          'importado_em',
          'created_at',
          'updated_at',
        ].join(','))
        .in('tipo_ordem', TIPOS)

      if (ano) query = query.eq('competencia_ano', ano)
      if (mes) query = query.eq('competencia_mes', mes)

      return query
        .order('data_entrada', { ascending: true })
        .range(from, to)
    }),
    fetchAllRows<{ competencia_ano: number | string | null }>((from, to) => {
      return supabase
        .from('vw_financeiro_ordens')
        .select('competencia_ano')
        .not('competencia_ano', 'is', null)
        .range(from, to)
    }),
    fetchAllRows<{ ano: number | string | null }>((from, to) => {
      return supabase
        .from('cartao_corporativo_gastos')
        .select('ano')
        .not('ano', 'is', null)
        .range(from, to)
    }),
    fetchAllRows<CartaoGastoRow>((from, to) => {
      let query = supabase
        .from('cartao_corporativo_gastos')
        .select('data,fornecedor,centro_custo,valor,ano,mes')

      if (ano) query = query.eq('ano', ano)
      if (mes) query = query.eq('mes', mes)

      return query
        .order('data', { ascending: true })
        .range(from, to)
    }),
  ])

  const yearsFromOrdens = yearsFromOrdensRaw
    .map((row) => row.competencia_ano)
    .map((value) => toNumber(value))
    .filter((value) => value > 0)
  const yearsFromCartao = yearsFromCartaoRaw
    .map((row) => row.ano)
    .map((value) => toNumber(value))
    .filter((value) => value > 0)
  const yearOptions = Array.from(new Set([currentYear, ...yearsFromOrdens, ...yearsFromCartao]))
    .sort((left, right) => right - left)

  const byTipo = Object.fromEntries(
    TIPOS.map((tipo) => {
      const filteredRows = rows.filter((row) => row.tipo_ordem === tipo)
      return [tipo, {
        summary: buildSummary(tipo, filteredRows),
        evolucao: buildMonthlyEvolution(filteredRows),
        unidades: buildRanking(filteredRows, (row) => row.denominacao_unidade ?? 'Sem unidade', 10),
        servicos: buildRanking(filteredRows, (row) => row.texto_breve ?? 'Sem servico', 12),
        fornecedores: buildRanking(filteredRows, (row) => row.fornecedor_nome ?? row.fornecedor_codigo ?? 'Sem fornecedor', 12),
      }]
    })
  ) as Record<FinanceiroTipoOrdem, {
    summary: FinanceiroKpiSummary
    evolucao: FinanceiroEvolucaoMes[]
    unidades: FinanceiroRankingRow[]
    servicos: FinanceiroRankingRow[]
    fornecedores: FinanceiroRankingRow[]
  }>

  const cartaoKpi = buildCartaoKpi(cartaoRows)
  const cartaoMensal = buildCartaoMensal(cartaoRows)
  const cartaoFornecedores = buildCartaoRanking(cartaoRows, (row) => row.fornecedor, 10)
  const cartaoCentros = buildCartaoRanking(cartaoRows, (row) => row.centro_custo ?? 'Sem centro', 10)
  const hasCartaoData = cartaoRows.length > 0

  const hasImportedData = yearOptions.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Custos operacionais por ordem.
          </p>
        </div>
        <div className="flex gap-2">
          <CartaoImportDialog />
          <FinanceiroImportDialog />
        </div>
      </div>

      <FinanceiroFilters
        anos={yearOptions}
        anoAtivo={ano}
        mesAtivo={mes}
      />

      {!hasImportedData ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm font-medium">Nenhuma base financeira importada ainda.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Use o botao de importacao para carregar a planilha SAP financeira.
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
