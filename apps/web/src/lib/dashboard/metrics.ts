import type {
  CargaAdministrador,
  DashboardFluxoDiario90d,
  DashboardProdutividade60d,
  Especialidade,
  NotaStatus,
  SyncLog,
} from '@/lib/types/database'
import type {
  DashboardAlert,
  DashboardKpiItem,
  DashboardProductivityRow,
  DashboardSummaryMetrics,
  DashboardTeamCapacityRow,
  DashboardThroughputPoint,
} from '@/lib/types/dashboard'

export interface OpenNotaAgingRow {
  data_criacao_sap: string | null
  created_at: string
  status: NotaStatus
}

const HOUR_MS = 60 * 60 * 1000
const DASHBOARD_WINDOW_DAYS = 30
const AGING_THRESHOLD_HOURS = 48
const AGING_WARNING_COUNT = 10
const SYNC_STALE_MINUTES = 60

const OPEN_STATUS_SET = new Set<NotaStatus>([
  'nova',
  'em_andamento',
  'encaminhada_fornecedor',
])

const ESPECIALIDADE_LABEL: Record<Especialidade, string> = {
  refrigeracao: 'Refrigeracao',
  elevadores: 'Elevadores',
  geral: 'Geral',
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDayKey(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function normalizeDay(value: string): string {
  return value.slice(0, 10)
}

function normalizeEspecialidade(value: string | null | undefined): Especialidade {
  if (value === 'refrigeracao' || value === 'elevadores' || value === 'geral') {
    return value
  }
  return 'geral'
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function formatPercentFromRatio(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  return `${Math.round(safe * 100)}%`
}

function getAgingReferenceMs(row: OpenNotaAgingRow): number | null {
  if (row.data_criacao_sap) {
    const dateMs = Date.parse(`${row.data_criacao_sap}T00:00:00Z`)
    return Number.isFinite(dateMs) ? dateMs : null
  }

  const createdMs = Date.parse(row.created_at)
  return Number.isFinite(createdMs) ? createdMs : null
}

export function buildThroughput30d(
  rows: DashboardFluxoDiario90d[],
  now: Date = new Date()
): DashboardThroughputPoint[] {
  const countsByDay = new Map<string, { entradas: number; concluidas: number }>()

  for (const row of rows) {
    const key = normalizeDay(row.dia)
    countsByDay.set(key, {
      entradas: toNumber(row.qtd_entradas),
      concluidas: toNumber(row.qtd_concluidas),
    })
  }

  const end = toUtcDay(now)
  const start = addUtcDays(end, -(DASHBOARD_WINDOW_DAYS - 1))
  const points: DashboardThroughputPoint[] = []

  for (let i = 0; i < DASHBOARD_WINDOW_DAYS; i += 1) {
    const current = addUtcDays(start, i)
    const dayKey = toDayKey(current)
    const base = countsByDay.get(dayKey)

    points.push({
      dia: dayKey,
      label: `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`,
      qtd_entradas: base?.entradas ?? 0,
      qtd_concluidas: base?.concluidas ?? 0,
    })
  }

  return points
}

export function buildTeamCapacityRows(carga: CargaAdministrador[]): DashboardTeamCapacityRow[] {
  const grouped = new Map<Especialidade, DashboardTeamCapacityRow>()

  for (const especialidade of Object.keys(ESPECIALIDADE_LABEL) as Especialidade[]) {
    grouped.set(especialidade, {
      especialidade,
      label: ESPECIALIDADE_LABEL[especialidade],
      admins: 0,
      abertas: 0,
      media_abertas: 0,
    })
  }

  for (const row of carga) {
    const especialidade = normalizeEspecialidade(row.especialidade)
    const target = grouped.get(especialidade)
    if (!target) continue

    target.admins += 1
    target.abertas += toNumber(row.qtd_abertas)
  }

  const result = [...grouped.values()].map((item) => ({
    ...item,
    media_abertas: item.abertas / Math.max(item.admins, 1),
  }))

  return result.sort((a, b) => b.media_abertas - a.media_abertas)
}

export function buildProductivityRanking(
  rows: DashboardProdutividade60d[]
): DashboardProductivityRow[] {
  return rows
    .map((row) => {
      const concluidas30d = toNumber(row.concluidas_30d)
      const concluidasPrev30d = toNumber(row.concluidas_prev_30d)
      return {
        administrador_id: row.administrador_id,
        nome: row.nome,
        avatar_url: row.avatar_url,
        especialidade: normalizeEspecialidade(row.especialidade),
        concluidas_30d: concluidas30d,
        concluidas_prev_30d: concluidasPrev30d,
        variacao_30d: concluidas30d - concluidasPrev30d,
      }
    })
    .sort((a, b) => {
      if (b.concluidas_30d !== a.concluidas_30d) {
        return b.concluidas_30d - a.concluidas_30d
      }
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
}

export function buildDashboardSummary(params: {
  carga: CargaAdministrador[]
  notasSemAtribuir: number
  notasAbertas: OpenNotaAgingRow[]
  throughput30d: DashboardThroughputPoint[]
  now?: Date
}): DashboardSummaryMetrics {
  const now = params.now ?? new Date()
  const nowMs = now.getTime()

  const abertasAgora = params.carga.reduce((acc, row) => acc + toNumber(row.qtd_abertas), 0)

  const aging48h = params.notasAbertas.reduce((acc, row) => {
    if (!OPEN_STATUS_SET.has(row.status)) return acc
    const referenceMs = getAgingReferenceMs(row)
    if (referenceMs === null) return acc
    return nowMs - referenceMs > AGING_THRESHOLD_HOURS * HOUR_MS ? acc + 1 : acc
  }, 0)

  const entradas30d = params.throughput30d.reduce((acc, row) => acc + row.qtd_entradas, 0)
  const concluidas30d = params.throughput30d.reduce((acc, row) => acc + row.qtd_concluidas, 0)

  return {
    abertas_agora: abertasAgora,
    sem_atribuir: params.notasSemAtribuir,
    aging_48h: aging48h,
    entradas_30d: entradas30d,
    concluidas_30d: concluidas30d,
    taxa_fechamento_30d: concluidas30d / Math.max(entradas30d, 1),
  }
}

export function buildKpis(summary: DashboardSummaryMetrics): DashboardKpiItem[] {
  return [
    {
      id: 'abertas_agora',
      label: 'Abertas agora',
      value: formatInteger(summary.abertas_agora),
      tone: 'neutral',
    },
    {
      id: 'sem_atribuir',
      label: 'Sem atribuir',
      value: formatInteger(summary.sem_atribuir),
      tone: summary.sem_atribuir > 0 ? 'danger' : 'success',
    },
    {
      id: 'aging_48h',
      label: 'Aging > 48h',
      value: formatInteger(summary.aging_48h),
      tone: summary.aging_48h >= AGING_WARNING_COUNT ? 'warning' : 'neutral',
    },
    {
      id: 'concluidas_30d',
      label: 'Concluidas (30d)',
      value: formatInteger(summary.concluidas_30d),
      tone: 'success',
    },
    {
      id: 'taxa_fechamento_30d',
      label: 'Taxa de fechamento',
      value: formatPercentFromRatio(summary.taxa_fechamento_30d),
      tone: summary.taxa_fechamento_30d >= 1 ? 'success' : 'warning',
    },
  ]
}

export function buildAlerts(params: {
  summary: DashboardSummaryMetrics
  latestSync: SyncLog | null
  now?: Date
}): DashboardAlert[] {
  const now = params.now ?? new Date()
  const nowMs = now.getTime()
  const alerts: DashboardAlert[] = []

  if (params.summary.sem_atribuir > 0) {
    alerts.push({
      id: 'sem-atribuir',
      level: 'critical',
      title: 'Notas sem atribuicao',
      description: `${formatInteger(params.summary.sem_atribuir)} nota(s) nova(s) aguardando distribuicao.`,
    })
  }

  if (!params.latestSync) {
    alerts.push({
      id: 'sync-ausente',
      level: 'critical',
      title: 'Sem historico de sync',
      description: 'Nenhum sync encontrado no sistema.',
    })
  } else {
    const startedAtMs = Date.parse(params.latestSync.started_at)
    const isSyncError = params.latestSync.status === 'error'
    const minutesSinceSync = Number.isFinite(startedAtMs)
      ? Math.round((nowMs - startedAtMs) / (60 * 1000))
      : Number.POSITIVE_INFINITY
    const isStale = minutesSinceSync > SYNC_STALE_MINUTES

    if (isSyncError || isStale) {
      alerts.push({
        id: 'sync-critico',
        level: 'critical',
        title: 'Saude do sync em risco',
        description: isSyncError
          ? 'Ultimo sync retornou erro.'
          : `Ultimo sync iniciado ha ${minutesSinceSync} min (limite ${SYNC_STALE_MINUTES} min).`,
      })
    }
  }

  if (params.summary.aging_48h >= AGING_WARNING_COUNT) {
    alerts.push({
      id: 'aging',
      level: 'warning',
      title: 'Backlog envelhecido',
      description: `${formatInteger(params.summary.aging_48h)} nota(s) aberta(s) acima de 48h.`,
    })
  }

  if (alerts.length === 0) {
    alerts.push({
      id: 'saudavel',
      level: 'info',
      title: 'Operacao estavel',
      description: 'Nenhum alerta critico ou de aviso no momento.',
    })
  }

  return alerts
}

export function getEspecialidadeLabel(especialidade: Especialidade): string {
  return ESPECIALIDADE_LABEL[especialidade]
}
