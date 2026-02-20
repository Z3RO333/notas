import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  applyAutomaticOrdersRouting,
  canAccessPmplTab,
  getFixedOwnerLabelByAdminId,
  resolveCurrentPmplOwner,
} from '@/lib/orders/pmpl-routing'
import type {
  OrdemNotaAcompanhamento,
  OrdersOwnerSummary,
  OrdersWorkspaceCursor,
  OrdersWorkspaceKpis,
  OrdersWorkspaceResponse,
  OrdersPeriodModeOperational,
  OrderReassignTarget,
  UserRole,
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
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

function asText(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  return parsed
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
  if (!parsed) return DEFAULT_LIMIT
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function emptyKpis(): OrdersWorkspaceKpis {
  return {
    total: 0,
    abertas: 0,
    em_tratativa: 0,
    em_avaliacao: 0,
    concluidas: 0,
    canceladas: 0,
    avaliadas: 0,
    atrasadas: 0,
    sem_responsavel: 0,
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: loggedAdmin, error: loggedAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (loggedAdminError || !loggedAdmin) {
    return NextResponse.json({ error: 'Administrador não encontrado' }, { status: 403 })
  }

  const role = loggedAdmin.role as UserRole
  const canViewGlobal = role === 'gestor'
  const debugOrdersRouting = process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1'

  let fixedOwnerLabelByAdminId = new Map<string, string>()
  try {
    fixedOwnerLabelByAdminId = await getFixedOwnerLabelByAdminId(supabase)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao carregar responsáveis fixos' }, { status: 500 })
  }

  if (canViewGlobal) {
    try {
      const routingResult = await applyAutomaticOrdersRouting({
        supabase,
        gestorId: loggedAdmin.id,
        debug: debugOrdersRouting,
        motivo: 'Auto realocação PMPL/CD (Painel de Ordens)',
      })
      fixedOwnerLabelByAdminId = routingResult.fixedOwnerLabelByAdminId
    } catch (error) {
      console.error('[orders/routing] falha ao aplicar realocação automática:', error)
    }
  }

  let canAccessPmpl = canViewGlobal
  if (!canViewGlobal) {
    try {
      const pmplResolution = await resolveCurrentPmplOwner(supabase)
      canAccessPmpl = canAccessPmplTab({
        role,
        loggedAdminId: loggedAdmin.id,
        pmplResolution,
      })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao validar acesso PMPL' }, { status: 500 })
    }
  }

  const { searchParams } = new URL(request.url)
  const periodMode = resolvePeriodMode(searchParams.get('periodMode'))
  const year = asInt(searchParams.get('year'))
  const month = asInt(searchParams.get('month'))
  const startIso = asIso(searchParams.get('startIso'))
  const endExclusiveIso = asIso(searchParams.get('endExclusiveIso'))
  const q = asText(searchParams.get('q'))
  const status = normalizeStatus(searchParams.get('status'))
  const unidade = asText(searchParams.get('unidade'))
  const responsavel = asText(searchParams.get('responsavel'))
  const prioridade = normalizePrioridade(searchParams.get('prioridade'))
  const cursorDetectada = asIso(searchParams.get('cursorDetectada'))
  const cursorOrdemId = asUuid(searchParams.get('cursorOrdemId'))
  const limit = resolveLimit(searchParams.get('limit'))

  const requestedTipoOrdem = normalizeTipoOrdem(searchParams.get('tipoOrdem'))
  let tipoOrdem: 'PMOS' | 'PMPL' | null = requestedTipoOrdem === 'todas'
    ? null
    : (requestedTipoOrdem ?? 'PMOS')

  if (tipoOrdem === 'PMPL' && !canAccessPmpl) {
    tipoOrdem = 'PMOS'
  }

  const adminScope = canViewGlobal ? null : loggedAdmin.id
  const responsavelFilter = canViewGlobal ? responsavel : null

  const [rowsResult, kpisResult, summaryResult, targetsResult] = await Promise.all([
    supabase.rpc('buscar_ordens_workspace', {
      p_period_mode: periodMode,
      p_year: year,
      p_month: month,
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_status: status,
      p_unidade: unidade,
      p_responsavel: responsavelFilter,
      p_prioridade: prioridade,
      p_q: q,
      p_admin_scope: adminScope,
      p_tipo_ordem: tipoOrdem,
      p_cursor_detectada: cursorDetectada,
      p_cursor_ordem_id: cursorOrdemId,
      p_limit: limit,
    }),
    supabase.rpc('calcular_kpis_ordens_operacional', {
      p_period_mode: periodMode,
      p_year: year,
      p_month: month,
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_status: status,
      p_unidade: unidade,
      p_responsavel: responsavelFilter,
      p_prioridade: prioridade,
      p_q: q,
      p_admin_scope: adminScope,
      p_tipo_ordem: tipoOrdem,
    }),
    supabase.rpc('calcular_resumo_colaboradores_ordens', {
      p_period_mode: periodMode,
      p_year: year,
      p_month: month,
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_status: status,
      p_unidade: unidade,
      p_responsavel: responsavelFilter,
      p_prioridade: prioridade,
      p_q: q,
      p_admin_scope: adminScope,
      p_tipo_ordem: tipoOrdem,
    }),
    canViewGlobal
      ? supabase
        .from('administradores')
        .select('id, nome, avatar_url')
        .eq('role', 'admin')
        .eq('ativo', true)
        .eq('em_ferias', false)
        .order('nome')
      : Promise.resolve({ data: [] as OrderReassignTarget[], error: null }),
  ])

  if (rowsResult.error) {
    return NextResponse.json({ error: rowsResult.error.message }, { status: 500 })
  }

  if (kpisResult.error) {
    return NextResponse.json({ error: kpisResult.error.message }, { status: 500 })
  }

  if (summaryResult.error) {
    return NextResponse.json({ error: summaryResult.error.message }, { status: 500 })
  }

  if (targetsResult.error) {
    return NextResponse.json({ error: targetsResult.error.message }, { status: 500 })
  }

  const rows = (rowsResult.data ?? []) as OrdemNotaAcompanhamento[]
  const rawSummary = (summaryResult.data ?? []) as Array<Partial<OrdersOwnerSummary>>
  const summary: OrdersOwnerSummary[] = rawSummary.map((item) => {
    const adminId = item.administrador_id ?? null
    return {
      administrador_id: adminId,
      nome: (adminId && fixedOwnerLabelByAdminId.get(adminId)) ?? item.nome ?? 'Sem nome',
      avatar_url: item.avatar_url ?? null,
      total: Number(item.total ?? 0),
      abertas: Number(item.abertas ?? 0),
      recentes: Number(item.recentes ?? 0),
      atencao: Number(item.atencao ?? 0),
      atrasadas: Number(item.atrasadas ?? 0),
    }
  })
  const rawKpis = (kpisResult.data ?? {}) as Partial<OrdersWorkspaceKpis>

  if (process.env.DEBUG_KPIS === '1') {
    console.log('[DEBUG workspace/kpis] raw RPC response:', JSON.stringify(kpisResult.data))
  }

  const kpis: OrdersWorkspaceKpis = {
    total: Number(rawKpis.total ?? 0),
    abertas: Number(rawKpis.abertas ?? 0),
    em_tratativa: Number(rawKpis.em_tratativa ?? 0),
    em_avaliacao: Number(rawKpis.em_avaliacao ?? 0),
    concluidas: Number(rawKpis.concluidas ?? 0),
    canceladas: Number(rawKpis.canceladas ?? 0),
    avaliadas: Number(rawKpis.avaliadas ?? 0),
    atrasadas: Number(rawKpis.atrasadas ?? 0),
    sem_responsavel: Number(rawKpis.sem_responsavel ?? 0),
  }

  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null
  const nextCursor: OrdersWorkspaceCursor | null = rows.length === limit && lastRow
    ? {
      ordem_detectada_em: lastRow.ordem_detectada_em,
      ordem_id: lastRow.ordem_id,
    }
    : null

  const response: OrdersWorkspaceResponse = {
    rows,
    nextCursor,
    kpis: kpis ?? emptyKpis(),
    ownerSummary: summary,
    reassignTargets: ((targetsResult.data ?? []) as OrderReassignTarget[]),
    currentUser: {
      role,
      adminId: loggedAdmin.id,
      canViewGlobal,
      canAccessPmpl,
    },
  }

  return NextResponse.json(response)
}
