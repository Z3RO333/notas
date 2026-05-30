import type { ReactNode } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OperacionalDashboardPeriod } from '@/lib/dashboard/operacional-period'
import type {
  OperacionalKpis,
  OrdersWorkspaceKpis,
  ProdutividadeOperacional,
  ServicoMaisFeito,
  LojaPorOperacional,
  OrdensAbertasLoja,
  EvolucaoMensalOperacional,
  ProdutividadeLoja,
} from '@/lib/types/database'
import { ProdutividadeTable } from './produtividade-table'
import {
  StatusBarChart,
  OrdensAbertasLojaChart,
  EvolucaoMensalOperacionalChart,
  ProdutividadeLojaChart,
} from './charts-lazy'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'

interface AdminOperacionalSectionProps {
  period: OperacionalDashboardPeriod
  fornecedorCodigo?: string | null
  especialidade?: string | null
  avatarByCode?: Record<string, string>
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isRpcWithoutOptionalParamSupport(
  error: Pick<PostgrestError, 'code' | 'message' | 'details' | 'hint'> | null,
  paramName: string,
): boolean {
  if (!error) return false

  return (
    error.code === 'PGRST202'
    || error.code === '42883'
    || includesToken(error.message, paramName)
    || includesToken(error.details, paramName)
    || includesToken(error.hint, paramName)
  )
}

async function callRpcWithOptionalParam<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcName: string,
  params: Record<string, unknown>,
  optionalParam: string,
): Promise<{ data: T | null; error: PostgrestError | null }> {
  const withParam = await supabase.rpc(rpcName, params)
  if (withParam.error && isRpcWithoutOptionalParamSupport(withParam.error, optionalParam)) {
    const fallbackParams = { ...params }
    delete fallbackParams[optionalParam]

    console.warn(`[admin/operacional] RPC ${rpcName} sem suporte a ${optionalParam}; repetindo chamada sem esse parametro.`)

    const fallback = await supabase.rpc(rpcName, fallbackParams)
    return {
      data: (fallback.data ?? null) as T | null,
      error: fallback.error,
    }
  }

  return {
    data: (withParam.data ?? null) as T | null,
    error: withParam.error,
  }
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{value.toLocaleString('pt-BR')}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function ServicosRecorrentesList({ rows, periodLabel }: { rows: ServicoMaisFeito[]; periodLabel: string }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Serviços Recorrentes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum serviço recorrente encontrado no período.</p>
        </CardContent>
      </Card>
    )
  }

  const maxQtd = rows[0]?.quantidade ?? 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Serviços Recorrentes
          <span className="ml-2 text-xs font-normal text-muted-foreground">({periodLabel})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate pr-2">{row.texto_breve}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.quantidade.toLocaleString('pt-BR')} ({row.pct_total.toFixed(1)}%)
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(row.quantidade / maxQtd) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export async function AdminOperacionalSection({ period, fornecedorCodigo, especialidade, avatarByCode = {} }: AdminOperacionalSectionProps) {
  const supabase = await createClient()
  const filtro = fornecedorCodigo ?? undefined
  const filtroEspecialidade = especialidade ?? undefined

  const [
    kpisResult,
    kpisOrdensGlobalPmosResult,
    produtividadeResult,
    servicosResult,
    lojasResult,
    abertasLojaResult,
    evolucaoResult,
    produtividadeLojaResult,
  ] = await Promise.all([
    callRpcWithOptionalParam<OperacionalKpis[]>(
      supabase,
      'calcular_kpis_operacionais',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<OrdersWorkspaceKpis>(
      supabase,
      'calcular_kpis_ordens_operacional',
      {
        p_period_mode: 'range',
        p_year: null,
        p_month: null,
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_status: null,
        p_unidade: null,
        p_responsavel: null,
        p_prioridade: null,
        p_q: null,
        p_admin_scope: null,
        p_tipo_ordem: 'PMOS',
      },
      'p_tipo_ordem',
    ),
    callRpcWithOptionalParam<ProdutividadeOperacional[]>(
      supabase,
      'calcular_produtividade_operacionais',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_limit: 50,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<ServicoMaisFeito[]>(
      supabase,
      'calcular_servicos_mais_feitos',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_limit: 10,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<LojaPorOperacional[]>(
      supabase,
      'calcular_lojas_por_operacional',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<OrdensAbertasLoja[]>(
      supabase,
      'calcular_ordens_abertas_por_loja',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_limit: 15,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<EvolucaoMensalOperacional[]>(
      supabase,
      'calcular_evolucao_mensal_operacionais',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
    callRpcWithOptionalParam<ProdutividadeLoja[]>(
      supabase,
      'calcular_produtividade_por_loja',
      {
        p_data_inicio: period.startIso,
        p_data_fim: period.endExclusiveIso,
        p_limit: 15,
        p_fornecedor_codigo: filtro,
        p_especialidade: filtroEspecialidade,
      },
      'p_especialidade',
    ),
  ])

  const firstError = [
    kpisResult.error,
    kpisOrdensGlobalPmosResult.error,
    produtividadeResult.error,
    servicosResult.error,
    lojasResult.error,
    abertasLojaResult.error,
    evolucaoResult.error,
    produtividadeLojaResult.error,
  ].find(Boolean)
  if (firstError) throw firstError

  const kpisRaw = (kpisResult.data ?? [{}])[0] as Partial<OperacionalKpis>
  const kpis: OperacionalKpis = {
    total_operacionais: Number(kpisRaw.total_operacionais ?? 0),
    ordens_atendidas: Number(kpisRaw.ordens_atendidas ?? 0),
    ordens_em_aberto: Number(kpisRaw.ordens_em_aberto ?? 0),
    lojas_atendidas: Number(kpisRaw.lojas_atendidas ?? 0),
    total_ordens: Number(kpisRaw.total_ordens ?? 0),
  }
  const kpisOrdensGlobalPmosData = kpisOrdensGlobalPmosResult.data
  const kpisOrdensGlobalPmosRaw = (
    Array.isArray(kpisOrdensGlobalPmosData)
      ? (kpisOrdensGlobalPmosData[0] ?? {})
      : (kpisOrdensGlobalPmosData ?? {})
  ) as Partial<OrdersWorkspaceKpis>
  const totalOrdensGeralPmosPeriodo = Number(kpisOrdensGlobalPmosRaw.total ?? 0)
  const pctAtendidasVsGeral = totalOrdensGeralPmosPeriodo > 0
    ? (kpis.ordens_atendidas / totalOrdensGeralPmosPeriodo) * 100
    : 0

  const produtividade = (produtividadeResult.data ?? []) as ProdutividadeOperacional[]
  const servicos = (servicosResult.data ?? []) as ServicoMaisFeito[]
  const abertasLoja = (abertasLojaResult.data ?? []) as OrdensAbertasLoja[]
  const evolucao = (evolucaoResult.data ?? []) as EvolucaoMensalOperacional[]
  const produtividadeLoja = (produtividadeLojaResult.data ?? []) as ProdutividadeLoja[]

  const lojasRaw = (lojasResult.data ?? []) as LojaPorOperacional[]
  const lojasMap: Record<string, LojaPorOperacional[]> = {}
  for (const loja of lojasRaw) {
    if (!lojasMap[loja.fornecedor_codigo]) lojasMap[loja.fornecedor_codigo] = []
    lojasMap[loja.fornecedor_codigo].push(loja)
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Operacional</h2>
          <p className="text-sm text-muted-foreground">
            Produtividade dos colaboradores operacionais (fornecedores) no período selecionado.
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Período: {period.periodLabel}
        </span>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Operacionais Ativos" value={kpis.total_operacionais} />
        <KpiCard label="Total de Ordens" value={kpis.total_ordens} />
        <KpiCard
          label="Ordens Atendidas"
          value={kpis.ordens_atendidas}
          sub={(
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {pctAtendidasVsGeral.toFixed(1)}% do percentual geral
            </span>
          )}
        />
        <KpiCard label="Ordens em Aberto" value={kpis.ordens_em_aberto} />
        <KpiCard label="Lojas Atendidas" value={kpis.lojas_atendidas} />
      </div>

      {/* Tabela + Servicos recorrentes */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProdutividadeTable
            rows={produtividade}
            lojasMap={lojasMap}
            periodLabel={period.periodLabel}
            totalOrdensGeralPmosPeriodo={totalOrdensGeralPmosPeriodo}
            startIso={period.startIso}
            endExclusiveIso={period.endExclusiveIso}
            fornecedorCodigo={fornecedorCodigo}
            avatarByCode={avatarByCode}
          />
        </div>
        <ServicosRecorrentesList rows={servicos} periodLabel={period.periodLabel} />
      </div>

      {/* Gráficos */}
      <ChartLabelsProvider>
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <StatusBarChart rows={produtividade} periodLabel={period.periodLabel} />
          <OrdensAbertasLojaChart
            rows={abertasLoja}
            periodLabel={period.periodLabel}
            startIso={period.startIso}
            endExclusiveIso={period.endExclusiveIso}
            fornecedorCodigo={fornecedorCodigo}
          />
          <EvolucaoMensalOperacionalChart rows={evolucao} periodLabel={period.periodLabel} />
          <ProdutividadeLojaChart
            rows={produtividadeLoja}
            periodLabel={period.periodLabel}
            startIso={period.startIso}
            endExclusiveIso={period.endExclusiveIso}
            fornecedorCodigo={fornecedorCodigo}
          />
        </div>
      </ChartLabelsProvider>
    </section>
  )
}
