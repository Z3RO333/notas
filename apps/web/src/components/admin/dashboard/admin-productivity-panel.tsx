import { Suspense } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  BriefcaseBusiness,
  ClipboardCheck,
  Gauge,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import {
  normalizeFornecedorCodigo,
  pickOperationalAvatarCodes,
} from '@/lib/dashboard/admin-productivity-data'
import { EvolucaoMensalOperacionalChart, StatusBarChart } from './charts-lazy'
import type { AdminProductivityPeriod } from '@/lib/dashboard/productivity-month'
import type {
  EvolucaoMensalOperacional,
  OperacionalKpis,
  OrdemNotaRankingAdmin,
  OrdersWorkspaceKpis,
  ProdutividadeOperacional,
} from '@/lib/types/database'
import { cn } from '@/lib/utils'

interface AdminProductivityPanelProps {
  period: AdminProductivityPeriod
  especialidade?: string | null
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
  avatar_url: string | null
  deltaConcluidas: number
}

type AdminRankingView = {
  administrador_id: string
  nome: string
  avatar_url: string | null
  total: number
  concluidas: number
  abertas: number
  em_tratativa: number
  atrasadas: number
  taxa_fechamento: number
  deltaConcluidas: number
}

type PodiumEntry = {
  rank: 1 | 2 | 3
  key: string
  name: string
  avatarUrl: string | null
  primary: string
  secondary: string
  tertiary?: string
}

const EXCLUDED_ADMIN_RANKING_NAMES = new Set([
  'DANIEL DAMASCENO',
  'GUSTAVO ANDRADE',
  'BRENDA FONSECA',
])

function resolvePeriodScopeLabel(period: AdminProductivityPeriod): 'ano' | 'mês' {
  return period.month === null ? 'ano' : 'mês'
}

function resolveSelectedScopeLabel(period: AdminProductivityPeriod): 'ano selecionado' | 'mês selecionado' {
  return period.month === null ? 'ano selecionado' : 'mês selecionado'
}

function resolveEvaluatedBadgeLabel(period: AdminProductivityPeriod): 'Ano avaliado' | 'Mês avaliado' {
  return period.month === null ? 'Ano avaliado' : 'Mês avaliado'
}

function resolveHighlightLabel(period: AdminProductivityPeriod): 'Destaque do ano' | 'Destaque do mês' {
  return period.month === null ? 'Destaque do ano' : 'Destaque do mês'
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizePersonName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${formatDecimal(value)}%`
}

function formatSignedInteger(value: number): string {
  if (value > 0) return `+${formatInteger(value)}`
  if (value < 0) return `-${formatInteger(Math.abs(value))}`
  return '0'
}

function formatComparisonCount(current: number, previous: number, referenceLabel: string): string {
  const delta = current - previous
  if (delta > 0) return `${formatInteger(delta)} a mais que ${referenceLabel}`
  if (delta < 0) return `${formatInteger(Math.abs(delta))} a menos que ${referenceLabel}`
  return `Mesmo volume de ${referenceLabel}`
}

function formatComparisonRate(current: number, previous: number, referenceLabel: string): string {
  const delta = current - previous
  if (delta > 0) return `${formatDecimal(delta)} pontos percentuais acima de ${referenceLabel}`
  if (delta < 0) return `${formatDecimal(Math.abs(delta))} pontos percentuais abaixo de ${referenceLabel}`
  return `Mesmo percentual de ${referenceLabel}`
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
  supabase: ReturnType<typeof createAdminClient>,
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
  avatarByCode: Map<string, string | null> = new Map(),
): OperationalRankingView[] {
  const previousBySupplier = new Map(
    previousRows.map((row) => [normalizeFornecedorCodigo(row.fornecedor_codigo), row]),
  )

  return currentRows.map((row) => {
    const codigoBase = normalizeFornecedorCodigo(row.fornecedor_codigo)
    return {
      ...row,
      avatar_url: avatarByCode.get(codigoBase) ?? null,
      deltaConcluidas: row.atendidas - toNumber(previousBySupplier.get(codigoBase)?.atendidas),
    }
  })
}

function buildAdminRows(
  currentRows: OrdemNotaRankingAdmin[],
  previousRows: OrdemNotaRankingAdmin[],
  avatarByAdminId: Map<string, string | null>,
): AdminRankingView[] {
  const previousByAdmin = new Map(previousRows.map((row) => [row.administrador_id, row]))

  return currentRows
    .filter((row) => !EXCLUDED_ADMIN_RANKING_NAMES.has(normalizePersonName(row.nome)))
    .map((row) => {
      const total = toNumber(row.qtd_ordens_30d)
      const concluidas = toNumber(row.qtd_concluidas_30d)

      return {
        administrador_id: row.administrador_id,
        nome: row.nome,
        avatar_url: avatarByAdminId.get(row.administrador_id) ?? null,
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

const PODIUM_LAYOUT: Array<1 | 2 | 3> = [2, 1, 3]

function getPodiumStyle(rank: 1 | 2 | 3) {
  if (rank === 1) {
    return {
      column: 'pt-0',
      avatar: 'ring-4 ring-amber-300 shadow-[0_10px_30px_rgba(245,158,11,0.28)]',
      pedestal: 'min-h-[10rem] border-amber-200 bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 text-amber-950',
    }
  }

  if (rank === 2) {
    return {
      column: 'pt-10',
      avatar: 'ring-4 ring-slate-300 shadow-[0_10px_26px_rgba(148,163,184,0.22)]',
      pedestal: 'min-h-[8rem] border-slate-200 bg-gradient-to-b from-slate-50 via-slate-200 to-slate-500 text-slate-900',
    }
  }

  return {
    column: 'pt-14',
    avatar: 'ring-4 ring-orange-300 shadow-[0_10px_24px_rgba(194,120,31,0.24)]',
    pedestal: 'min-h-[7rem] border-orange-200 bg-gradient-to-b from-orange-50 via-orange-200 to-orange-500 text-orange-950',
  }
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
  description?: string
  badge?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className={cn('space-y-1', !description && 'space-y-0')}>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
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

function RankingPodium({
  entries,
  emptyMessage,
}: {
  entries: PodiumEntry[]
  emptyMessage: string
}) {
  if (entries.length === 0) {
    return (
      <div className="px-6 pb-6">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  const entryByRank = new Map(
    entries
      .filter((entry) => entry != null && entry.key != null && entry.rank != null)
      .map((entry) => [entry.rank, entry]),
  )

  return (
    <div className="border-b bg-muted/10 px-6 pb-6 pt-4">
      <div className="grid grid-cols-3 gap-3 md:gap-5">
        {PODIUM_LAYOUT.map((rank) => {
          const entry = entryByRank.get(rank)

          if (!entry?.key) {
            return <div key={`empty-${rank}`} />
          }

          const style = getPodiumStyle(rank)

          return (
            <div key={entry.key} className={cn('flex flex-col items-center justify-end', style.column)}>
              <div className="mb-3 flex flex-col items-center text-center">
                <Avatar
                  src={entry.avatarUrl}
                  nome={entry.name}
                  size={rank === 1 ? 'xl' : 'lg'}
                  className={style.avatar}
                />
                <p className="mt-3 line-clamp-2 text-sm font-semibold leading-tight">{entry.name}</p>
                <p className="mt-1 text-xs font-semibold text-foreground/90">{entry.primary}</p>
                <p className="text-[11px] text-muted-foreground">{entry.secondary}</p>
                {entry.tertiary ? (
                  <p className="text-[11px] text-muted-foreground">{entry.tertiary}</p>
                ) : null}
              </div>

              <div className={cn('flex w-full items-center justify-center rounded-t-[1.75rem] border px-3 py-4 text-center shadow-sm', style.pedestal)}>
                <span className="text-4xl font-black leading-none md:text-5xl">{rank}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OperationalPodiumCard({
  rows,
  totalConcluidas,
  scopeLabel,
}: {
  rows: OperationalRankingView[]
  totalConcluidas: number
  scopeLabel: 'ano' | 'mês'
}) {
  const entries: PodiumEntry[] = rows.slice(0, 3).map((row, index) => {
    const share = totalConcluidas > 0 ? (row.atendidas / totalConcluidas) * 100 : 0

    return {
      rank: (index + 1) as 1 | 2 | 3,
      key: row.fornecedor_codigo,
      name: row.fornecedor_nome || row.fornecedor_codigo,
      avatarUrl: row.avatar_url,
      primary: `${formatInteger(row.atendidas)} concluídas`,
      secondary: `${formatPercent(row.pct_conclusao)} de taxa`,
      tertiary: `${formatPercent(share)} do ${scopeLabel}`,
    }
  })

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Pódio de operacionais</CardTitle>
        <p className="text-xs text-muted-foreground">
          Destaques do {scopeLabel} por ordens concluídas, com taxa de conclusão e participação no período.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <RankingPodium
          entries={entries}
          emptyMessage="Nenhum operacional com produção no período selecionado."
        />
      </CardContent>
    </Card>
  )
}

function AdminPodiumCard({
  rows,
  scopeLabel,
}: {
  rows: AdminRankingView[]
  scopeLabel: 'ano' | 'mês'
}) {
  const entries: PodiumEntry[] = rows.slice(0, 3).map((row, index) => ({
    rank: (index + 1) as 1 | 2 | 3,
    key: row.administrador_id,
    name: row.nome,
    avatarUrl: row.avatar_url,
    primary: `${formatInteger(row.concluidas)} concluídas`,
    secondary: `${formatPercent(row.taxa_fechamento)} de taxa`,
    tertiary: `${formatInteger(row.atrasadas)} atrasadas`,
  }))

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Pódio de administradores</CardTitle>
        <p className="text-xs text-muted-foreground">
          Destaques do {scopeLabel} por ordens concluídas, com taxa de fechamento e volume de atraso.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <RankingPodium
          entries={entries}
          emptyMessage="Nenhum administrador com ordens no período selecionado."
        />
      </CardContent>
    </Card>
  )
}

function OperationalRankingCard({
  rows,
  totalConcluidas,
  scopeLabel,
}: {
  rows: OperationalRankingView[]
  totalConcluidas: number
  scopeLabel: 'ano' | 'mês'
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Ranking de operacionais</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por ordens concluídas no {scopeLabel}, com taxa de conclusão e variação em relação à base anterior.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">Nenhum operacional com produção no período selecionado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-6 pb-3 font-medium">#</th>
                  <th className="pb-3 pr-3 font-medium">Operacional</th>
                  <th className="pb-3 pr-3 text-right font-medium">Concluídas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Taxa</th>
                  <th className="pb-3 pr-3 text-right font-medium">Lojas</th>
                  <th className="pb-3 pr-6 text-right font-medium">Variação</th>
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
                        <p className="text-xs text-muted-foreground">{formatPercent(share)} das concluídas do {scopeLabel}</p>
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

function AdminRankingCard({
  rows,
  scopeLabel,
}: {
  rows: AdminRankingView[]
  scopeLabel: 'ano' | 'mês'
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Ranking de administradores</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por ordens concluídas no {scopeLabel}, com taxa de fechamento e backlog atrasado.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">Nenhum administrador com ordens no período selecionado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-6 pb-3 font-medium">#</th>
                  <th className="pb-3 pr-3 font-medium">Administrador</th>
                  <th className="pb-3 pr-3 text-right font-medium">Concluídas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Taxa</th>
                  <th className="pb-3 pr-3 text-right font-medium">Tratadas</th>
                  <th className="pb-3 pr-3 text-right font-medium">Atrasadas</th>
                  <th className="pb-3 pr-6 text-right font-medium">Variação</th>
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

function OperacionalSectionSkeleton() {
  return (
    <section className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted/30" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="h-64 rounded-lg border bg-muted/30" />
          <div className="h-72 rounded-lg border bg-muted/30" />
        </div>
        <div className="h-64 rounded-lg border bg-muted/30" />
      </div>
    </section>
  )
}

function AdminSectionSkeleton() {
  return (
    <section className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted/30" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="h-64 rounded-lg border bg-muted/30" />
          <div className="h-72 rounded-lg border bg-muted/30" />
        </div>
        <div className="space-y-6">
          <div className="h-48 rounded-lg border bg-muted/30" />
          <div className="h-48 rounded-lg border bg-muted/30" />
        </div>
      </div>
    </section>
  )
}

async function OperacionalSection({ period, especialidade }: AdminProductivityPanelProps) {
  const supabase = createAdminClient()
  const filtroEspecialidade = especialidade ?? undefined

  const [
    currentKpisResult,
    previousKpisResult,
    currentRowsResult,
    previousRowsResult,
    evolutionResult,
  ] = await Promise.all([
    supabase.rpc('calcular_kpis_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_fornecedor_codigo: null,
      p_especialidade: filtroEspecialidade,
    }),
    supabase.rpc('calcular_kpis_operacionais', {
      p_data_inicio: period.previous.startIso,
      p_data_fim: period.previous.endExclusiveIso,
      p_fornecedor_codigo: null,
      p_especialidade: filtroEspecialidade,
    }),
    supabase.rpc('calcular_produtividade_operacionais', {
      p_data_inicio: period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_limit: 50,
      p_fornecedor_codigo: null,
      p_especialidade: filtroEspecialidade,
    }),
    supabase.rpc('calcular_produtividade_operacionais', {
      p_data_inicio: period.previous.startIso,
      p_data_fim: period.previous.endExclusiveIso,
      p_limit: 50,
      p_fornecedor_codigo: null,
      p_especialidade: filtroEspecialidade,
    }),
    supabase.rpc('calcular_evolucao_mensal_operacionais', {
      p_data_inicio: period.rollingMonths[0]?.startIso ?? period.startIso,
      p_data_fim: period.endExclusiveIso,
      p_fornecedor_codigo: null,
      p_especialidade: filtroEspecialidade,
    }),
  ])

  const firstError = [
    currentKpisResult.error,
    previousKpisResult.error,
    currentRowsResult.error,
    previousRowsResult.error,
    evolutionResult.error,
  ].find(Boolean)

  if (firstError) throw firstError

  const currentKpis = normalizeOperacionalKpis(currentKpisResult.data)
  const previousKpis = normalizeOperacionalKpis(previousKpisResult.data)
  const currentRowsRaw = (currentRowsResult.data ?? []) as ProdutividadeOperacional[]
  const previousRowsRaw = (previousRowsResult.data ?? []) as ProdutividadeOperacional[]

  const avatarByCode = new Map<string, string | null>()
  const avatarCodes = pickOperationalAvatarCodes(currentRowsRaw)
  if (avatarCodes.length > 0) {
    const avatarResult = await supabase
      .from('dim_operacionais')
      .select('codigo, avatar_url')
      .in('codigo', avatarCodes)
      .not('avatar_url', 'is', null)

    if (!avatarResult.error) {
      for (const row of avatarResult.data ?? []) {
        avatarByCode.set(row.codigo, row.avatar_url)
      }
    }
  }

  const rows = buildOperationalRows(currentRowsRaw, previousRowsRaw, avatarByCode)
  const evolution = (evolutionResult.data ?? []) as EvolucaoMensalOperacional[]

  const rate = currentKpis.total_ordens > 0
    ? (currentKpis.ordens_atendidas / currentKpis.total_ordens) * 100
    : 0
  const ratePrevious = previousKpis.total_ordens > 0
    ? (previousKpis.ordens_atendidas / previousKpis.total_ordens) * 100
    : 0
  const top = rows[0] ?? null
  const bestRate = pickBestRateOperational(currentRowsRaw)
  const withProductionCount = rows.filter((row) => row.total_ordens > 0).length
  const withProductionPreviousCount = previousRowsRaw.filter((row) => row.total_ordens > 0).length
  const highPerformanceCount = rows.filter((row) => row.pct_conclusao >= 80 && row.total_ordens >= 5).length
  const coverage = [...rows].sort((left, right) => {
    if (right.lojas_atendidas !== left.lojas_atendidas) return right.lojas_atendidas - left.lojas_atendidas
    return right.atendidas - left.atendidas
  })[0] ?? null
  const recognition: RecognitionItem[] = [
    top
      ? {
        label: 'Mais concluiu',
        name: top.fornecedor_nome || top.fornecedor_codigo,
        value: `${formatInteger(top.atendidas)} ordens concluídas`,
      }
      : { label: 'Mais concluiu', name: 'Sem destaque', value: 'Nenhuma produção no período.' },
    bestRate
      ? {
        label: 'Melhor taxa',
        name: bestRate.fornecedor_nome || bestRate.fornecedor_codigo,
        value: `${formatPercent(bestRate.pct_conclusao)} de conclusão`,
      }
      : { label: 'Melhor taxa', name: 'Sem destaque', value: 'Nenhuma base válida no período.' },
    coverage
      ? {
        label: 'Maior cobertura',
        name: coverage.fornecedor_nome || coverage.fornecedor_codigo,
        value: `${formatInteger(coverage.lojas_atendidas)} lojas atendidas`,
      }
      : { label: 'Maior cobertura', name: 'Sem destaque', value: 'Nenhuma cobertura registrada.' },
  ]
  const scopeLabel = resolvePeriodScopeLabel(period)
  const selectedScopeLabel = resolveSelectedScopeLabel(period)
  const evaluatedBadgeLabel = resolveEvaluatedBadgeLabel(period)
  const highlightLabel = resolveHighlightLabel(period)
  const trendLabel = period.month === null
    ? period.label
    : `${period.rollingMonths[0]?.label ?? period.label} a ${period.label}`

  return (
    <section className="space-y-6">
      <SectionHeading
        title="Operacionais"
        badge={(
          <div className="flex items-center gap-2">
            {especialidade && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {especialidade === 'eletricista' ? 'Eletricistas' : especialidade === 'mecanico_auto' ? 'Mec. Auto' : especialidade}
              </span>
            )}
            <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">{evaluatedBadgeLabel}: {period.label}</span>
          </div>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ClipboardCheck}
          label="Ordens concluídas"
          value={formatInteger(currentKpis.ordens_atendidas)}
          helper={`Base do ${scopeLabel} ${period.label}.`}
          deltaLabel={formatComparisonCount(
            currentKpis.ordens_atendidas,
            previousKpis.ordens_atendidas,
            period.previous.label,
          )}
          deltaTone={resolveDeltaTone(currentKpis.ordens_atendidas - previousKpis.ordens_atendidas)}
          tone="success"
        />
        <MetricCard
          icon={Gauge}
          label="Taxa de conclusão"
          value={formatPercent(rate)}
          helper={`${formatInteger(currentKpis.total_ordens)} ordens no ${selectedScopeLabel}.`}
          deltaLabel={formatComparisonRate(rate, ratePrevious, period.previous.label)}
          deltaTone={resolveDeltaTone(rate - ratePrevious)}
          tone={rate >= 80 ? 'success' : rate >= 60 ? 'warning' : 'default'}
        />
        <MetricCard
          icon={Users}
          label="Operacionais com produção"
          value={formatInteger(withProductionCount)}
          helper={`${formatInteger(highPerformanceCount)} com taxa acima de 80%.`}
          deltaLabel={formatComparisonCount(
            withProductionCount,
            withProductionPreviousCount,
            period.previous.label,
          )}
          deltaTone={resolveDeltaTone(withProductionCount - withProductionPreviousCount)}
        />
        <MetricCard
          icon={Trophy}
          label={highlightLabel}
          value={top ? (top.fornecedor_nome || top.fornecedor_codigo) : 'Sem base'}
          helper={top ? `${formatInteger(top.atendidas)} concluídas e ${formatPercent(top.pct_conclusao)} de taxa.` : 'Nenhum operacional com produção no período.'}
          tone="success"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <OperationalPodiumCard
            rows={rows}
            totalConcluidas={currentKpis.ordens_atendidas}
            scopeLabel={scopeLabel}
          />
          <OperationalRankingCard
            rows={rows}
            totalConcluidas={currentKpis.ordens_atendidas}
            scopeLabel={scopeLabel}
          />
        </div>
        <RecognitionCard
          title="Indicadores para reconhecimento"
          subtitle="Leituras objetivas para premiação e acompanhamento do período."
          items={recognition}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <StatusBarChart rows={currentRowsRaw.slice(0, 10)} periodLabel={period.label} />
        <EvolucaoMensalOperacionalChart rows={evolution} periodLabel={trendLabel} />
      </div>
    </section>
  )
}

async function AdminSection({ period }: { period: AdminProductivityPeriod }) {
  const supabase = createAdminClient()

  const [
    currentKpisResult,
    previousKpisResult,
    currentRankingResult,
    previousRankingResult,
    evolutionResult,
  ] = await Promise.all([
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
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(supabase, 'calcular_ranking_ordens_admin', {
      p_start_iso: period.startIso,
      p_end_exclusive_iso: period.endExclusiveIso,
      p_tipo_ordem: null,
    }),
    callRpcWithOptionalTipoOrdem<OrdemNotaRankingAdmin[]>(supabase, 'calcular_ranking_ordens_admin', {
      p_start_iso: period.previous.startIso,
      p_end_exclusive_iso: period.previous.endExclusiveIso,
      p_tipo_ordem: null,
    }),
    supabase.rpc('calcular_evolucao_mensal_admin', {
      p_data_inicio: period.rollingMonths[0]?.startIso ?? period.startIso,
      p_data_fim: period.endExclusiveIso,
    }),
  ])

  const firstError = [
    currentKpisResult.error,
    previousKpisResult.error,
    currentRankingResult.error,
    previousRankingResult.error,
    evolutionResult.error,
  ].find(Boolean)

  if (firstError) throw firstError

  const currentKpis = normalizeOrdersKpis(currentKpisResult.data)
  const previousKpis = normalizeOrdersKpis(previousKpisResult.data)
  const currentRankingRaw = (currentRankingResult.data ?? []) as OrdemNotaRankingAdmin[]
  const previousRankingRaw = (previousRankingResult.data ?? []) as OrdemNotaRankingAdmin[]
  const evolution = (evolutionResult.data ?? []) as EvolucaoMensalOperacional[]

  const avatarById = new Map<string, string | null>()
  const avatarIds = Array.from(new Set(currentRankingRaw.map((row) => row.administrador_id).filter(Boolean)))
  if (avatarIds.length > 0) {
    const avatarResult = await supabase
      .from('administradores')
      .select('id, avatar_url')
      .in('id', avatarIds)

    if (!avatarResult.error) {
      for (const row of avatarResult.data ?? []) {
        avatarById.set(row.id, row.avatar_url)
      }
    }
  }

  const rows = buildAdminRows(currentRankingRaw, previousRankingRaw, avatarById)

  const rate = currentKpis.total > 0 ? (currentKpis.concluidas / currentKpis.total) * 100 : 0
  const ratePrevious = previousKpis.total > 0 ? (previousKpis.concluidas / previousKpis.total) * 100 : 0
  const pending = currentKpis.abertas + currentKpis.em_tratativa + currentKpis.em_avaliacao
  const withProduction = rows.filter((row) => row.total > 0).length
  const withProductionPrevious = previousRankingRaw.filter((row) => toNumber(row.qtd_ordens_30d) > 0).length
  const withoutDelay = rows.filter((row) => row.atrasadas === 0 && row.total >= 5).length
  const top = rows[0] ?? null
  const bestRate = pickBestRateAdmin(rows)
  const lowestDelay = [...rows]
    .filter((row) => row.total >= 5)
    .sort((left, right) => {
      if (left.atrasadas !== right.atrasadas) return left.atrasadas - right.atrasadas
      return right.concluidas - left.concluidas
    })[0] ?? rows[0] ?? null
  const recognition: RecognitionItem[] = [
    top
      ? {
        label: 'Mais concluiu',
        name: top.nome,
        value: `${formatInteger(top.concluidas)} ordens concluídas`,
      }
      : { label: 'Mais concluiu', name: 'Sem destaque', value: 'Nenhuma produção no período.' },
    bestRate
      ? {
        label: 'Melhor taxa',
        name: bestRate.nome,
        value: `${formatPercent(bestRate.taxa_fechamento)} de fechamento`,
      }
      : { label: 'Melhor taxa', name: 'Sem destaque', value: 'Nenhuma base válida no período.' },
    lowestDelay
      ? {
        label: 'Melhor backlog',
        name: lowestDelay.nome,
        value: `${formatInteger(lowestDelay.atrasadas)} ordem(ns) atrasada(s)`,
      }
      : { label: 'Melhor backlog', name: 'Sem destaque', value: 'Nenhum backlog comparavel.' },
  ]
  const scopeLabel = resolvePeriodScopeLabel(period)
  const selectedScopeLabel = resolveSelectedScopeLabel(period)
  const highlightLabel = resolveHighlightLabel(period)
  const trendLabel = period.month === null
    ? period.label
    : `${period.rollingMonths[0]?.label ?? period.label} a ${period.label}`

  return (
    <section className="space-y-6">
      <SectionHeading
        title="Administradores"
        description="Painel de performance dos administradores, com foco em ordens concluídas, taxa de fechamento, volume tratado e ranking do período."
        badge={<span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Comparativo base: {period.previous.label}</span>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={BriefcaseBusiness}
          label="Ordens concluídas"
          value={formatInteger(currentKpis.concluidas)}
          helper={`Total tratado no ${scopeLabel}: ${formatInteger(currentKpis.total)} ordens.`}
          deltaLabel={formatComparisonCount(
            currentKpis.concluidas,
            previousKpis.concluidas,
            period.previous.label,
          )}
          deltaTone={resolveDeltaTone(currentKpis.concluidas - previousKpis.concluidas)}
          tone="success"
        />
        <MetricCard
          icon={Gauge}
          label="Taxa de fechamento"
          value={formatPercent(rate)}
          helper={`${formatInteger(pending)} ainda pendentes no ${scopeLabel}.`}
          deltaLabel={formatComparisonRate(rate, ratePrevious, period.previous.label)}
          deltaTone={resolveDeltaTone(rate - ratePrevious)}
          tone={rate >= 70 ? 'success' : rate >= 50 ? 'warning' : 'default'}
        />
        <MetricCard
          icon={Users}
          label="Admins com produção"
          value={formatInteger(withProduction)}
          helper={`${formatInteger(withoutDelay)} sem atraso vermelho no ${scopeLabel}.`}
          deltaLabel={formatComparisonCount(
            withProduction,
            withProductionPrevious,
            period.previous.label,
          )}
          deltaTone={resolveDeltaTone(withProduction - withProductionPrevious)}
        />
        <MetricCard
          icon={ShieldCheck}
          label={highlightLabel}
          value={top?.nome ?? 'Sem base'}
          helper={top ? `${formatInteger(top.concluidas)} concluídas e ${formatPercent(top.taxa_fechamento)} de fechamento.` : 'Nenhum administrador com ordens no período.'}
          tone="success"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <AdminPodiumCard rows={rows} scopeLabel={scopeLabel} />
          <AdminRankingCard rows={rows} scopeLabel={scopeLabel} />
        </div>
        <div className="space-y-6">
          <RecognitionCard
            title="Indicadores para reconhecimento"
            subtitle="Base do período para premiação, reconhecimento e calibragem da carteira."
            items={recognition}
          />
          <SnapshotCard
            title="Leitura rápida da produtividade"
            items={[
              { label: 'Ordens tratadas', value: currentKpis.total },
              { label: 'Ordens concluídas', value: currentKpis.concluidas },
              { label: 'Ordens pendentes', value: pending, tone: 'warning' },
              { label: `Admins com produção no ${selectedScopeLabel}`, value: withProduction },
              { label: 'Admins sem atraso', value: withoutDelay },
            ]}
          />
        </div>
      </div>

      <EvolucaoMensalOperacionalChart rows={evolution} periodLabel={trendLabel} />
    </section>
  )
}

export function AdminProductivityPanel({ period, especialidade }: AdminProductivityPanelProps) {
  return (
    <ChartLabelsProvider>
      <div className="space-y-10">
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>

        <Suspense fallback={<OperacionalSectionSkeleton />}>
          <OperacionalSection period={period} especialidade={especialidade} />
        </Suspense>

        <Suspense fallback={<AdminSectionSkeleton />}>
          <AdminSection period={period} />
        </Suspense>
      </div>
    </ChartLabelsProvider>
  )
}
