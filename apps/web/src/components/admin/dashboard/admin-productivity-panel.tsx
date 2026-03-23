import type { ComponentType, ReactNode } from 'react'
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import { EvolucaoMensalOperacionalChart } from './evolucao-mensal-operacional-chart'
import { StatusBarChart } from './status-bar-chart'
import type { AdminProductivityPeriod } from '@/lib/dashboard/productivity-month'
import type {
  EvolucaoMensalOperacional,
  OperacionalKpis,
  OrdemNotaRankingAdmin,
  OrdersWorkspaceKpis,
  ProdutividadeOperacional,
} from '@/lib/types/database'

interface AdminProductivityPanelProps {
  period: AdminProductivityPeriod
}

type DeltaTone = 'positive' | 'negative' | 'neutral'
type MetricCardTone = 'default' | 'success' | 'warning'

type MetricCardProps = {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  helper: string
  deltaLabel?: string
  deltaTone?: DeltaTone
  tone?: MetricCardTone
}

type RecognitionItem = {
  label: string
  name: string
  value: string
}

type OperationalRankingView = ProdutividadeOperacional & {
  deltaConcluidas: number
}

type AdminRankingView = {
  administrador_id: string
  nome: string
  total: number
  concluidas: number
  abertas: number
  em_tratativa: number
  atrasadas: number
  taxa_fechamento: number
  deltaConcluidas: number
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatSignedInteger(value: number): string {
  if (value > 0) return `+${formatInteger(value)}`
  if (value < 0) return `-${formatInteger(Math.abs(value))}`
  return '0'
}

function formatSignedPp(current: number, previous: number): string {
  const delta = current - previous
  const signal = delta > 0 ? '+' : ''
  return `${signal}${delta.toFixed(1)} p.p.`
}

function resolveDeltaTone(value: number): DeltaTone {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

function getDeltaClasses(tone: DeltaTone): string {
  if (tone === 'positive') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (tone === 'negative') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
  return 'border-border bg-muted/50 text-muted-foreground'
}

function getMetricToneClasses(tone: MetricCardTone): { icon: string; value: string } {
  if (tone === 'success') {
    return {
      icon: 'text-emerald-600 dark:text-emerald-400',
      value: 'text-emerald-700 dark:text-emerald-300',
    }
  }

  if (tone === 'warning') {
    return {
      icon: 'text-amber-600 dark:text-amber-400',
      value: 'text-amber-700 dark:text-amber-300',
    }
  }

  return {
    icon: 'text-slate-600 dark:text-slate-400',
    value: 'text-foreground',
  }
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isRpcWithoutTipoOrdemSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null,
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  return (
    includesToken(error.message, 'p_tipo_ordem')
    || includesToken(error.details, 'p_tipo_ordem')
    || includesToken(error.hint, 'p_tipo_ordem')
  )
}

async function callRpcWithOptionalTipoOrdem<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcName: string,
  params: Record<string, unknown>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const withTipo = await supabase.rpc(rpcName, params)
  if (withTipo.error && isRpcWithoutTipoOrdemSupport(withTipo.error)) {
    const fallbackParams = { ...params }
    delete fallbackParams.p_tipo_ordem

    const fallback = await supabase.rpc(rpcName, fallbackParams)
    return {
      data: (fallback.data ?? null) as T | null,
      error: fallback.error ? { code: fallback.error.code, message: fallback.error.message } : null,
    }
  }

  return {
    data: (withTipo.data ?? null) as T | null,
    error: withTipo.error ? { code: withTipo.error.code, message: withTipo.error.message } : null,
  }
}

function normalizeOperacionalKpis(data: unknown): OperacionalKpis {
  const raw = (Array.isArray(data) ? data[0] : data) as Partial<OperacionalKpis> | undefined
  const ordensAtendidas = toNumber(raw?.ordens_atendidas)
  const ordensEmAberto = toNumber(raw?.ordens_em_aberto)
  const totalOrdens = toNumber(raw?.total_ordens) || (ordensAtendidas + ordensEmAberto)

  return {
    total_operacionais: toNumber(raw?.total_operacionais),
    ordens_atendidas: ordensAtendidas,
    ordens_em_aberto: ordensEmAberto,
    lojas_atendidas: toNumber(raw?.lojas_atendidas),
    total_ordens: totalOrdens,
  }
}

function normalizeOrdersKpis(data: unknown): OrdersWorkspaceKpis {
  const raw = (Array.isArray(data) ? data[0] : data) as Partial<OrdersWorkspaceKpis> | undefined

  return {
    total: toNumber(raw?.total),
    abertas: toNumber(raw?.abertas),
    em_tratativa: toNumber(raw?.em_tratativa),
    em_avaliacao: toNumber(raw?.em_avaliacao),
    concluidas: toNumber(raw?.concluidas),
    canceladas: toNumber(raw?.canceladas),
    avaliadas: toNumber(raw?.avaliadas),
    atrasadas: toNumber(raw?.atrasadas),
    sem_responsavel: toNumber(raw?.sem_responsavel),
  }
}

function buildOperationalRows(
  currentRows: ProdutividadeOperacional[],
  previousRows: ProdutividadeOperacional[],
): OperationalRankingView[] {
  const previousBySupplier = new Map(previousRows.map((row) => [row.fornecedor_codigo, row]))

  return currentRows.map((row) => ({
    ...row,
    deltaConcluidas: row.atendidas - toNumber(previousBySupplier.get(row.fornecedor_codigo)?.atendidas),
  }))
}

function buildAdminRows(
  currentRows: OrdemNotaRankingAdmin[],
  previousRows: OrdemNotaRankingAdmin[],
): AdminRankingView[] {
  const previousByAdmin = new Map(previousRows.map((row) => [row.administrador_id, row]))

  return currentRows
    .map((row) => {
      const total = toNumber(row.qtd_ordens_30d)
      const concluidas = toNumber(row.qtd_concluidas_30d)

      return {
        administrador_id: row.administrador_id,
        nome: row.nome,
        total,
        concluidas,
        abertas: toNumber(row.qtd_abertas_30d),
        em_tratativa: toNumber(row.qtd_em_tratativa_30d),
        atrasadas: toNumber(row.qtd_antigas_7d_30d),
        taxa_fechamento: total > 0 ? (concluidas / total) * 100 : 0,
        deltaConcluidas: concluidas - toNumber(previousByAdmin.get(row.administrador_id)?.qtd_concluidas_30d),
      }
    })
    .sort((left, right) => {
      if (right.concluidas !== left.concluidas) return right.concluidas - left.concluidas
      if (right.taxa_fechamento !== left.taxa_fechamento) return right.taxa_fechamento - left.taxa_fechamento
      if (right.total !== left.total) return right.total - left.total
      return left.nome.localeCompare(right.nome, 'pt-BR')
    })
}

function pickBestRateOperational(rows: ProdutividadeOperacional[]): ProdutividadeOperacional | null {
  return rows
    .filter((row) => row.total_ordens >= 5)
    .sort((left, right) => {
      if (right.pct_conclusao !== left.pct_conclusao) return right.pct_conclusao - left.pct_conclusao
      return right.atendidas - left.atendidas
    })[0] ?? rows[0] ?? null
}

function pickBestRateAdmin(rows: AdminRankingView[]): AdminRankingView | null {
  return rows
    .filter((row) => row.total >= 5)
    .sort((left, right) => {
      if (right.taxa_fechamento !== left.taxa_fechamento) return right.taxa_fechamento - left.taxa_fechamento
      return right.concluidas - left.concluidas
    })[0] ?? rows[0] ?? null
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  deltaLabel,
  deltaTone = 'neutral',
  tone = 'default',
}: MetricCardProps) {
  const classes = getMetricToneClasses(tone)

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className={`h-4 w-4 ${classes.icon}`} />
            <span>{label}</span>
          </CardTitle>
          {deltaLabel ? (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getDeltaClasses(deltaTone)}`}>
              {deltaLabel}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className={`text-3xl font-bold ${classes.value}`}>{value}</div>
        <p className="min-h-[2rem] text-xs leading-4 text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  )
}

function SectionHeading({
  title,
  description,
  badge,
}: {
  title: string
  description: string
  badge?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {badge}
    </div>
  )
}

function RecognitionCard({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle: string
  items: RecognitionItem[]
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={`${item.label}-${item.name}`} className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-sm font-semibold">{item.name}</p>
            <p className="text-xs text-muted-foreground">{item.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SnapshotCard({
  title,
  items,
}: {
  title: string
  items: Array<{ label: string; value: number; tone?: 'default' | 'warning' | 'danger' }>
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => {
          const valueClass = item.tone === 'danger'
            ? 'text-red-700 dark:text-red-300'
            : item.tone === 'warning'
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-foreground'

          return (
            <div key={item.label} className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className={`text-sm font-semibold ${valueClass}`}>{formatInteger(item.value)}</span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function OperationalRankingCard({
  rows,
  totalConcluidas,
}: {
  rows: OperationalRankingView[]
  totalConcluidas: number
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Ranking mensal de operacionais</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por ordens concluidas no mes, com taxa de conclusao e variacao vs mes anterior.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">Nenhum operacional com producao no mes selecionado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-6 pb-3 font-medium">#</th>
                  <th className="pb-3 pr-3 font-medium">Operacional</th>
                  <th className="pb-3 pr-3 text-right font-medium">Concluidas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Taxa</th>
                  <th className="pb-3 pr-3 text-right font-medium">Lojas</th>
                  <th className="pb-3 pr-6 text-right font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, index) => {
                  const share = totalConcluidas > 0 ? (row.atendidas / totalConcluidas) * 100 : 0

                  return (
                    <tr key={row.fornecedor_codigo} className="border-b last:border-0">
                      <td className="px-6 py-3 font-semibold text-muted-foreground">#{index + 1}</td>
                      <td className="py-3 pr-3">
                        <p className="font-medium">{row.fornecedor_nome || row.fornecedor_codigo}</p>
                        <p className="text-xs text-muted-foreground">{formatPercent(share)} das concluidas do mes</p>
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold text-emerald-700 dark:text-emerald-300">
                        {formatInteger(row.atendidas)}
                      </td>
                      <td className="py-3 pr-3 text-right">{formatPercent(row.pct_conclusao)}</td>
                      <td className="py-3 pr-3 text-right">{formatInteger(row.lojas_atendidas)}</td>
                      <td className="py-3 pr-6 text-right">
                        <span className={row.deltaConcluidas >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                          {formatSignedInteger(row.deltaConcluidas)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AdminRankingCard({ rows }: { rows: AdminRankingView[] }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Ranking mensal de administradores</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por ordens concluidas no mes, com taxa de fechamento e backlog atrasado.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">Nenhum administrador com ordens no mes selecionado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-6 pb-3 font-medium">#</th>
                  <th className="pb-3 pr-3 font-medium">Administrador</th>
                  <th className="pb-3 pr-3 text-right font-medium">Concluidas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Taxa</th>
                  <th className="pb-3 pr-3 text-right font-medium">Tratadas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Atrasadas</th>
                  <th className="pb-3 pr-6 text-right font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, index) => (
                  <tr key={row.administrador_id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-semibold text-muted-foreground">#{index + 1}</td>
                    <td className="py-3 pr-3 font-medium">{row.nome}</td>
                    <td className="py-3 pr-3 text-right font-semibold text-emerald-700 dark:text-emerald-300">
                      {formatInteger(row.concluidas)}
                    </td>
                    <td className="py-3 pr-3 text-right">{formatPercent(row.taxa_fechamento)}</td>
                    <td className="py-3 pr-3 text-right">{formatInteger(row.total)}</td>
                    <td className="py-3 pr-3 text-right text-red-700 dark:text-red-300">{formatInteger(row.atrasadas)}</td>
                    <td className="py-3 pr-6 text-right">
                      <span className={row.deltaConcluidas >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                        {formatSignedInteger(row.deltaConcluidas)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export async function AdminProductivityPanel({ period }: AdminProductivityPanelProps) {
  const supabase = await createClient()

  const adminEvolutionRequests = period.rollingMonths.map((monthWindow) => (
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: 'range',
      p_year: null,
      p_month: null,
      p_start_iso: monthWindow.startIso,
      p_end_exclusive_iso: monthWindow.endExclusiveIso,
      p_status: null,
      p_unidade: null,
      p_responsavel: null,
      p_prioridade: null,
      p_q: null,
      p_admin_scope: null,
      p_tipo_ordem: null,
    })
  ))

  const [
    operationalCurrentKpisResult,
    operationalPreviousKpisResult,
    operationalCurrentRowsResult,
    operationalPreviousRowsResult,
    operationalEvolutionResult,
    adminCurrentKpisResult,
    adminPreviousKpisResult,
    adminCurrentRankingResult,
    adminPreviousRankingResult,
    ...adminEvolutionResults
  ] = await Promise.all([
    supabase.rpc('calcular_kpis_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_fornecedor_codigo: null,
    }),
    supabase.rpc('calcular_kpis_operacionais', {
      p_data_inicio: period.previous.startIso,
      p_data_fim: period.previous.endExclusiveIso,
      p_fornecedor_codigo: null,
    }),
    supabase.rpc('calcular_produtividade_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_limit: 50,
      p_fornecedor_codigo: null,
    }),
    supabase.rpc('calcular_produtividade_operacionais', {
      p_data_inicio: period.previous.startIso,
      p_data_fim: period.previous.endExclusiveIso,
      p_limit: 50,
      p_fornecedor_codigo: null,
    }),
    supabase.rpc('calcular_evolucao_mensal_operacionais', {
      p_data_inicio: period.rollingMonths[0]?.startIso ?? period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_fornecedor_codigo: null,
    }),
    supabase.rpc('calcular_kpis_ordens_operacional', {
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
      p_tipo_ordem: null,
    }),
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: 'range',
      p_year: null,
      p_month: null,
      p_start_iso: period.previous.startIso,
      p_end_exclusive_iso: period.previous.endExclusiveIso,
      p_status: null,
      p_unidade: null,
      p_responsavel: null,
      p_prioridade: null,
      p_q: null,
      p_admin_scope: null,
      p_tipo_ordem: null,
    }),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(
      supabase,
      'calcular_ranking_ordens_admin',
      {
        p_start_iso: period.startIso,
        p_end_exclusive_iso: period.endExclusiveIso,
        p_tipo_ordem: null,
      },
    ),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(
      supabase,
      'calcular_ranking_ordens_admin',
      {
        p_start_iso: period.previous.startIso,
        p_end_exclusive_iso: period.previous.endExclusiveIso,
        p_tipo_ordem: null,
      },
    ),
    ...adminEvolutionRequests,
  ])

  const firstError = [
    operationalCurrentKpisResult.error,
    operationalPreviousKpisResult.error,
    operationalCurrentRowsResult.error,
    operationalPreviousRowsResult.error,
    operationalEvolutionResult.error,
    adminCurrentKpisResult.error,
    adminPreviousKpisResult.error,
    adminCurrentRankingResult.error,
    adminPreviousRankingResult.error,
    ...adminEvolutionResults.map((result) => result.error),
  ].find(Boolean)

  if (firstError) throw firstError

  const operationalCurrentKpis = normalizeOperacionalKpis(operationalCurrentKpisResult.data)
  const operationalPreviousKpis = normalizeOperacionalKpis(operationalPreviousKpisResult.data)
  const operationalCurrentRowsRaw = (operationalCurrentRowsResult.data ?? []) as ProdutividadeOperacional[]
  const operationalPreviousRowsRaw = (operationalPreviousRowsResult.data ?? []) as ProdutividadeOperacional[]
  const operationalRows = buildOperationalRows(operationalCurrentRowsRaw, operationalPreviousRowsRaw)
  const operationalEvolution = (operationalEvolutionResult.data ?? []) as EvolucaoMensalOperacional[]

  const adminCurrentKpis = normalizeOrdersKpis(adminCurrentKpisResult.data)
  const adminPreviousKpis = normalizeOrdersKpis(adminPreviousKpisResult.data)
  const adminCurrentRankingRaw = (adminCurrentRankingResult.data ?? []) as OrdemNotaRankingAdmin[]
  const adminPreviousRankingRaw = (adminPreviousRankingResult.data ?? []) as OrdemNotaRankingAdmin[]
  const adminRows = buildAdminRows(adminCurrentRankingRaw, adminPreviousRankingRaw)

  const adminEvolution = adminEvolutionResults.map((result, index) => {
    const kpis = normalizeOrdersKpis(result.data)
    const monthWindow = period.rollingMonths[index]

    return {
      ano: monthWindow?.year ?? period.year,
      mes: monthWindow?.month ?? period.month,
      label: monthWindow?.label ?? period.label,
      concluidas: kpis.concluidas,
      em_aberto: kpis.abertas + kpis.em_tratativa + kpis.em_avaliacao,
    }
  }) as EvolucaoMensalOperacional[]

  const operationalRate = operationalCurrentKpis.total_ordens > 0
    ? (operationalCurrentKpis.ordens_atendidas / operationalCurrentKpis.total_ordens) * 100
    : 0
  const operationalRatePrevious = operationalPreviousKpis.total_ordens > 0
    ? (operationalPreviousKpis.ordens_atendidas / operationalPreviousKpis.total_ordens) * 100
    : 0
  const operationalTop = operationalRows[0] ?? null
  const operationalBestRate = pickBestRateOperational(operationalCurrentRowsRaw)
  const operationalCoverage = [...operationalRows].sort((left, right) => {
    if (right.lojas_atendidas !== left.lojas_atendidas) return right.lojas_atendidas - left.lojas_atendidas
    return right.atendidas - left.atendidas
  })[0] ?? null
  const operationalRecognition: RecognitionItem[] = [
    operationalTop
      ? {
        label: 'Mais concluiu',
        name: operationalTop.fornecedor_nome || operationalTop.fornecedor_codigo,
        value: `${formatInteger(operationalTop.atendidas)} ordens concluidas`,
      }
      : { label: 'Mais concluiu', name: 'Sem destaque', value: 'Nenhuma producao no mes.' },
    operationalBestRate
      ? {
        label: 'Melhor taxa',
        name: operationalBestRate.fornecedor_nome || operationalBestRate.fornecedor_codigo,
        value: `${formatPercent(operationalBestRate.pct_conclusao)} de conclusao`,
      }
      : { label: 'Melhor taxa', name: 'Sem destaque', value: 'Nenhuma base valida no mes.' },
    operationalCoverage
      ? {
        label: 'Maior cobertura',
        name: operationalCoverage.fornecedor_nome || operationalCoverage.fornecedor_codigo,
        value: `${formatInteger(operationalCoverage.lojas_atendidas)} lojas atendidas`,
      }
      : { label: 'Maior cobertura', name: 'Sem destaque', value: 'Nenhuma cobertura registrada.' },
  ]

  const adminRate = adminCurrentKpis.total > 0
    ? (adminCurrentKpis.concluidas / adminCurrentKpis.total) * 100
    : 0
  const adminRatePrevious = adminPreviousKpis.total > 0
    ? (adminPreviousKpis.concluidas / adminPreviousKpis.total) * 100
    : 0
  const adminTop = adminRows[0] ?? null
  const adminBestRate = pickBestRateAdmin(adminRows)
  const adminLowestDelay = [...adminRows]
    .filter((row) => row.total >= 5)
    .sort((left, right) => {
      if (left.atrasadas !== right.atrasadas) return left.atrasadas - right.atrasadas
      return right.concluidas - left.concluidas
    })[0] ?? adminRows[0] ?? null
  const adminRecognition: RecognitionItem[] = [
    adminTop
      ? {
        label: 'Mais concluiu',
        name: adminTop.nome,
        value: `${formatInteger(adminTop.concluidas)} ordens concluidas`,
      }
      : { label: 'Mais concluiu', name: 'Sem destaque', value: 'Nenhuma producao no mes.' },
    adminBestRate
      ? {
        label: 'Melhor taxa',
        name: adminBestRate.nome,
        value: `${formatPercent(adminBestRate.taxa_fechamento)} de fechamento`,
      }
      : { label: 'Melhor taxa', name: 'Sem destaque', value: 'Nenhuma base valida no mes.' },
    adminLowestDelay
      ? {
        label: 'Melhor backlog',
        name: adminLowestDelay.nome,
        value: `${formatInteger(adminLowestDelay.atrasadas)} ordem(ns) atrasada(s)`,
      }
      : { label: 'Melhor backlog', name: 'Sem destaque', value: 'Nenhum backlog comparavel.' },
  ]

  const trendLabel = `${period.rollingMonths[0]?.label ?? period.label} a ${period.label}`

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <SectionHeading
          title="Operacionais"
          description="Painel mensal de produtividade dos colaboradores operacionais, com foco em concluidas, taxa de conclusao, ranking do mes e reconhecimento."
          badge={<span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Mes avaliado: {period.label}</span>}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={ClipboardCheck}
            label="Ordens concluidas"
            value={formatInteger(operationalCurrentKpis.ordens_atendidas)}
            helper={`Base do mes ${period.label}.`}
            deltaLabel={`${formatSignedInteger(operationalCurrentKpis.ordens_atendidas - operationalPreviousKpis.ordens_atendidas)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(operationalCurrentKpis.ordens_atendidas - operationalPreviousKpis.ordens_atendidas)}
            tone="success"
          />
          <MetricCard
            icon={Gauge}
            label="Taxa de conclusao"
            value={formatPercent(operationalRate)}
            helper={`${formatInteger(operationalCurrentKpis.total_ordens)} ordens no mes selecionado.`}
            deltaLabel={`${formatSignedPp(operationalRate, operationalRatePrevious)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(operationalRate - operationalRatePrevious)}
            tone={operationalRate >= 80 ? 'success' : operationalRate >= 60 ? 'warning' : 'default'}
          />
          <MetricCard
            icon={Users}
            label="Operacionais com producao"
            value={formatInteger(operationalRows.filter((row) => row.total_ordens > 0).length)}
            helper={`${formatInteger(operationalRows.filter((row) => row.pct_conclusao >= 80 && row.total_ordens >= 5).length)} com taxa acima de 80%.`}
            deltaLabel={`${formatSignedInteger(operationalRows.filter((row) => row.total_ordens > 0).length - operationalPreviousRowsRaw.filter((row) => row.total_ordens > 0).length)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(
              operationalRows.filter((row) => row.total_ordens > 0).length - operationalPreviousRowsRaw.filter((row) => row.total_ordens > 0).length,
            )}
          />
          <MetricCard
            icon={Trophy}
            label="Destaque do mes"
            value={operationalTop ? (operationalTop.fornecedor_nome || operationalTop.fornecedor_codigo) : 'Sem base'}
            helper={operationalTop ? `${formatInteger(operationalTop.atendidas)} concluidas e ${formatPercent(operationalTop.pct_conclusao)} de taxa.` : 'Nenhum operacional com producao no mes.'}
            tone="success"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <OperationalRankingCard
              rows={operationalRows}
              totalConcluidas={operationalCurrentKpis.ordens_atendidas}
            />
          </div>
          <RecognitionCard
            title="Indicadores para reconhecimento"
            subtitle="Leituras objetivas para premiacao e acompanhamento do mes."
            items={operationalRecognition}
          />
        </div>
      </section>

      <section className="space-y-6">
        <SectionHeading
          title="Administradores"
          description="Painel mensal de performance dos administradores, com foco em ordens concluidas, taxa de fechamento, volume tratado e ranking do mes."
          badge={<span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Comparativo base: {period.previous.label}</span>}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={BriefcaseBusiness}
            label="Ordens concluidas"
            value={formatInteger(adminCurrentKpis.concluidas)}
            helper={`Total tratado no mes: ${formatInteger(adminCurrentKpis.total)} ordens.`}
            deltaLabel={`${formatSignedInteger(adminCurrentKpis.concluidas - adminPreviousKpis.concluidas)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(adminCurrentKpis.concluidas - adminPreviousKpis.concluidas)}
            tone="success"
          />
          <MetricCard
            icon={Gauge}
            label="Taxa de fechamento"
            value={formatPercent(adminRate)}
            helper={`${formatInteger(adminCurrentKpis.abertas + adminCurrentKpis.em_tratativa + adminCurrentKpis.em_avaliacao)} ainda pendentes no mes.`}
            deltaLabel={`${formatSignedPp(adminRate, adminRatePrevious)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(adminRate - adminRatePrevious)}
            tone={adminRate >= 70 ? 'success' : adminRate >= 50 ? 'warning' : 'default'}
          />
          <MetricCard
            icon={Users}
            label="Admins com producao"
            value={formatInteger(adminRows.filter((row) => row.total > 0).length)}
            helper={`${formatInteger(adminRows.filter((row) => row.atrasadas === 0 && row.total >= 5).length)} sem atraso vermelho no mes.`}
            deltaLabel={`${formatSignedInteger(adminRows.filter((row) => row.total > 0).length - adminPreviousRankingRaw.filter((row) => toNumber(row.qtd_ordens_30d) > 0).length)} vs ${period.previous.label}`}
            deltaTone={resolveDeltaTone(
              adminRows.filter((row) => row.total > 0).length - adminPreviousRankingRaw.filter((row) => toNumber(row.qtd_ordens_30d) > 0).length,
            )}
          />
          <MetricCard
            icon={ShieldCheck}
            label="Destaque do mes"
            value={adminTop?.nome ?? 'Sem base'}
            helper={adminTop ? `${formatInteger(adminTop.concluidas)} concluidas e ${formatPercent(adminTop.taxa_fechamento)} de fechamento.` : 'Nenhum administrador com ordens no mes.'}
            tone="success"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <AdminRankingCard rows={adminRows} />
          </div>
          <div className="space-y-6">
            <RecognitionCard
              title="Indicadores para reconhecimento"
              subtitle="Base mensal para premiacao, reconhecimento e calibragem da carteira."
              items={adminRecognition}
            />
            <SnapshotCard
              title="Leitura rapida do mes"
              items={[
                { label: 'Em aberto', value: adminCurrentKpis.abertas, tone: 'warning' },
                { label: 'Em tratativa', value: adminCurrentKpis.em_tratativa },
                { label: 'Em avaliacao', value: adminCurrentKpis.em_avaliacao },
                { label: 'Atrasadas', value: adminCurrentKpis.atrasadas, tone: 'danger' },
                { label: 'Sem responsavel', value: adminCurrentKpis.sem_responsavel, tone: adminCurrentKpis.sem_responsavel > 0 ? 'danger' : 'default' },
              ]}
            />
          </div>
        </div>
      </section>

      <ChartLabelsProvider>
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <StatusBarChart rows={operationalCurrentRowsRaw.slice(0, 10)} periodLabel={period.label} />
          <EvolucaoMensalOperacionalChart rows={operationalEvolution} periodLabel={trendLabel} />
          <EvolucaoMensalOperacionalChart rows={adminEvolution} periodLabel={trendLabel} />
          <SnapshotCard
            title="Resumo comparativo"
            items={[
              {
                label: `Operacionais concluidas em ${period.label}`,
                value: operationalCurrentKpis.ordens_atendidas,
              },
              {
                label: `Operacionais concluidas em ${period.previous.label}`,
                value: operationalPreviousKpis.ordens_atendidas,
              },
              {
                label: `Admins concluidas em ${period.label}`,
                value: adminCurrentKpis.concluidas,
              },
              {
                label: `Admins concluidas em ${period.previous.label}`,
                value: adminPreviousKpis.concluidas,
              },
            ]}
          />
        </div>
      </ChartLabelsProvider>
    </div>
  )
}
