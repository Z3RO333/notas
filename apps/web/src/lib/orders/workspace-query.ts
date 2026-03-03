import type {
  OrdersPeriodModeOperational,
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
} from '@/lib/types/database'

const VALID_PERIOD_MODES: OrdersPeriodModeOperational[] = ['all', 'year', 'year_month', 'month', 'range']
const VALID_STATUS = new Set([
  'todas',
  'aberta',
  'em_tratativa',
  'em_avaliacao',
  'avaliadas',
  'nao_realizada',
  'concluida',
  'cancelada',
  'desconhecido',
])
const VALID_PRIORIDADE = new Set(['todas', 'verde', 'amarelo', 'vermelho'])
const VALID_TIPO_ORDEM = new Set(['PMOS', 'PMPL', 'todas'])

export const DEFAULT_ORDERS_WORKSPACE_LIMIT = 100
export const MAX_ORDERS_WORKSPACE_LIMIT = 200
export const ORDERS_TIPO_ORDEM_MIGRATION_HINT =
  'Aplique a migration 00045_tipo_ordem_pmpl_pmos_tabs.sql para habilitar o filtro PMPL/PMOS.'

interface ParsedOrdersWorkspaceRequest {
  periodMode: OrdersPeriodModeOperational
  year: number | null
  month: number | null
  startIso: string | null
  endExclusiveIso: string | null
  q: string | null
  status: string | null
  unidade: string | null
  responsavel: string | null
  prioridade: string | null
  cursorDetectada: string | null
  cursorOrdemId: string | null
  limit: number
  tipoOrdem: 'PMOS' | 'PMPL' | null
}

function asText(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

function asIso(value: string | null): string | null {
  const text = asText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function asUuid(value: string | null): string | null {
  const text = asText(value)
  if (!text) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return null
  return text
}

function normalizeStatus(value: string | null): string | null {
  const text = asText(value)?.toLowerCase() ?? null
  if (!text) return null
  return VALID_STATUS.has(text) ? text : null
}

function normalizePrioridade(value: string | null): string | null {
  const text = asText(value)?.toLowerCase() ?? null
  if (!text) return null
  return VALID_PRIORIDADE.has(text) ? text : null
}

function normalizeTipoOrdem(value: string | null): 'PMOS' | 'PMPL' | 'todas' | null {
  const text = asText(value)
  if (!text) return null
  return VALID_TIPO_ORDEM.has(text) ? (text as 'PMOS' | 'PMPL' | 'todas') : null
}

function resolvePeriodMode(value: string | null): OrdersPeriodModeOperational {
  const text = asText(value)?.toLowerCase() as OrdersPeriodModeOperational | undefined
  return text && VALID_PERIOD_MODES.includes(text) ? text : 'all'
}

function resolveLimit(value: string | null): number {
  const parsed = asInt(value)
  if (!parsed) return DEFAULT_ORDERS_WORKSPACE_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_ORDERS_WORKSPACE_LIMIT)
}

export function toIsoStart(dateInput: string | null): string | null {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function toIsoEndExclusive(dateInput: string | null): string | null {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

export function buildWorkspaceParams(
  filters: OrdersWorkspaceFilters,
  cursor: OrdersWorkspaceCursor | null,
  limit: number
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('periodMode', filters.periodMode)

  if (filters.year) params.set('year', String(filters.year))
  if (filters.month) params.set('month', String(filters.month))
  if (filters.startDate) params.set('startIso', toIsoStart(filters.startDate) ?? '')
  if (filters.endDate) params.set('endExclusiveIso', toIsoEndExclusive(filters.endDate) ?? '')

  if (filters.q) params.set('q', filters.q)
  if (filters.status && filters.status !== 'todas') params.set('status', filters.status)
  if (filters.responsavel && filters.responsavel !== 'todos') params.set('responsavel', filters.responsavel)
  if (filters.unidade) params.set('unidade', filters.unidade)
  if (filters.prioridade && filters.prioridade !== 'todas') params.set('prioridade', filters.prioridade)
  if (filters.tipoOrdem) params.set('tipoOrdem', filters.tipoOrdem)

  if (cursor) {
    params.set('cursorDetectada', cursor.ordem_detectada_em)
    params.set('cursorOrdemId', cursor.ordem_id)
  }

  params.set('limit', String(limit))
  return params
}

export function parseOrdersWorkspaceRequest(
  searchParams: URLSearchParams,
  canAccessPmpl: boolean
): ParsedOrdersWorkspaceRequest {
  const requestedTipoOrdem = normalizeTipoOrdem(searchParams.get('tipoOrdem'))
  let tipoOrdem: 'PMOS' | 'PMPL' | null = requestedTipoOrdem === 'todas'
    ? null
    : (requestedTipoOrdem ?? 'PMOS')

  if (tipoOrdem === 'PMPL' && !canAccessPmpl) {
    tipoOrdem = 'PMOS'
  }

  return {
    periodMode: resolvePeriodMode(searchParams.get('periodMode')),
    year: asInt(searchParams.get('year')),
    month: asInt(searchParams.get('month')),
    startIso: asIso(searchParams.get('startIso')),
    endExclusiveIso: asIso(searchParams.get('endExclusiveIso')),
    q: asText(searchParams.get('q')),
    status: normalizeStatus(searchParams.get('status')),
    unidade: asText(searchParams.get('unidade')),
    responsavel: asText(searchParams.get('responsavel')),
    prioridade: normalizePrioridade(searchParams.get('prioridade')),
    cursorDetectada: asIso(searchParams.get('cursorDetectada')),
    cursorOrdemId: asUuid(searchParams.get('cursorOrdemId')),
    limit: resolveLimit(searchParams.get('limit')),
    tipoOrdem,
  }
}

export function isRpcWithoutTipoOrdemSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202') return true

  return (
    `${error.message ?? ''}`.toLowerCase().includes('p_tipo_ordem')
    || `${error.details ?? ''}`.toLowerCase().includes('p_tipo_ordem')
    || `${error.hint ?? ''}`.toLowerCase().includes('p_tipo_ordem')
  )
}
