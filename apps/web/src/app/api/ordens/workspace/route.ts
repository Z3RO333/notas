import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
const ROUTING_BATCH_SIZE = 1000
const REASSIGN_CHUNK_SIZE = 200

const FIXED_OWNER_EMAIL_BY_KEY = {
  brenda: 'brendafonseca@bemol.com.br',
  adriano: 'adrianobezerra@bemol.com.br',
} as const

const FIXED_OWNER_LABEL_BY_KEY = {
  brenda: 'Brenda (CD MANAUS)',
  adriano: 'Adriano (CD TARUMÃ)',
} as const

const UNIT_TO_FIXED_OWNER_KEY = {
  'CD MANAUS': 'brenda',
  'CD TARUMA': 'adriano',
  'CD FARMA TARUMA': 'adriano',
} as const

const ROUTING_UNITS = Object.keys(UNIT_TO_FIXED_OWNER_KEY)

type FixedOwnerKey = keyof typeof FIXED_OWNER_EMAIL_BY_KEY

type FixedOwnerAdmin = {
  id: string
  email: string
}

type RoutingCandidateRow = {
  ordem_id: string
  nota_id: string
  ordem_codigo: string | null
  unidade: string | null
  responsavel_atual_id: string | null
  responsavel_atual_nome: string | null
}

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

function normalizeTipoOrdem(value: string | null): string | null {
  const text = asText(value)
  if (!text) return null
  return VALID_TIPO_ORDEM.has(text) ? text : null
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

function normalizeUnit(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function resolveFixedOwnerKeyByUnit(value: string | null | undefined): FixedOwnerKey | null {
  const normalized = normalizeUnit(value)
  if (!normalized) return null
  return UNIT_TO_FIXED_OWNER_KEY[normalized as keyof typeof UNIT_TO_FIXED_OWNER_KEY] ?? null
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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

  const debugCdRouting = process.env.DEBUG_ORDERS_CD_ROUTING === '1'

  const fixedOwnerEmailByKeyLower = {
    brenda: FIXED_OWNER_EMAIL_BY_KEY.brenda.toLowerCase(),
    adriano: FIXED_OWNER_EMAIL_BY_KEY.adriano.toLowerCase(),
  } as const

  const fixedOwnerKeyByEmail: Record<string, FixedOwnerKey> = {
    [fixedOwnerEmailByKeyLower.brenda]: 'brenda',
    [fixedOwnerEmailByKeyLower.adriano]: 'adriano',
  }

  const { data: fixedOwnersData, error: fixedOwnersError } = await supabase
    .from('administradores')
    .select('id, email, role, ativo')
    .in('email', Object.values(FIXED_OWNER_EMAIL_BY_KEY))

  if (fixedOwnersError) {
    return NextResponse.json({ error: fixedOwnersError.message }, { status: 500 })
  }

  const fixedOwnerByKey: Partial<Record<FixedOwnerKey, FixedOwnerAdmin>> = {}

  for (const item of ((fixedOwnersData ?? []) as Array<{ id: string; email: string; role: string; ativo: boolean }>)) {
    const normalizedEmail = item.email?.trim().toLowerCase()
    const key = fixedOwnerKeyByEmail[normalizedEmail]
    if (!key) continue
    if (item.role !== 'admin' || !item.ativo) continue

    fixedOwnerByKey[key] = {
      id: item.id,
      email: normalizedEmail,
    }
  }

  if (canViewGlobal) {
    try {
      const ownerKeys = (Object.keys(fixedOwnerByKey) as FixedOwnerKey[])
      if (ownerKeys.length > 0) {
        const routingRows: RoutingCandidateRow[] = []
        let from = 0

        while (true) {
          const { data, error } = await supabase
            .from('vw_ordens_notas_painel')
            .select('ordem_id, nota_id, ordem_codigo, unidade, responsavel_atual_id, responsavel_atual_nome')
            .in('unidade', ROUTING_UNITS)
            .not('nota_id', 'is', null)
            .order('ordem_id', { ascending: true })
            .range(from, from + ROUTING_BATCH_SIZE - 1)

          if (error) throw error

          const batch = (data ?? []) as RoutingCandidateRow[]
          routingRows.push(...batch)

          if (batch.length < ROUTING_BATCH_SIZE) break
          from += ROUTING_BATCH_SIZE
        }

        const detectedByUnit: Record<string, number> = {
          'CD MANAUS': 0,
          'CD TARUMA': 0,
          'CD FARMA TARUMA': 0,
        }

        const pendingByNota = new Map<string, {
          notaId: string
          administradorDestinoId: string
          ordemCodigo: string | null
          unidade: string | null
          responsavelAnteriorId: string | null
          responsavelAnteriorNome: string | null
          responsavelNovoNome: string
        }>()

        const conflictNotaIds = new Set<string>()

        for (const row of routingRows) {
          const ownerKey = resolveFixedOwnerKeyByUnit(row.unidade)
          if (!ownerKey) continue

          const normalizedUnit = normalizeUnit(row.unidade)
          if (normalizedUnit in detectedByUnit) {
            detectedByUnit[normalizedUnit] += 1
          }

          const fixedOwner = fixedOwnerByKey[ownerKey]
          if (!fixedOwner || !row.nota_id) continue

          if (row.responsavel_atual_id === fixedOwner.id) continue
          if (conflictNotaIds.has(row.nota_id)) continue

          const existing = pendingByNota.get(row.nota_id)
          if (existing && existing.administradorDestinoId !== fixedOwner.id) {
            conflictNotaIds.add(row.nota_id)
            pendingByNota.delete(row.nota_id)
            continue
          }

          if (!existing) {
            pendingByNota.set(row.nota_id, {
              notaId: row.nota_id,
              administradorDestinoId: fixedOwner.id,
              ordemCodigo: row.ordem_codigo,
              unidade: row.unidade,
              responsavelAnteriorId: row.responsavel_atual_id,
              responsavelAnteriorNome: row.responsavel_atual_nome,
              responsavelNovoNome: FIXED_OWNER_LABEL_BY_KEY[ownerKey],
            })
          }
        }

        const pendingList = Array.from(pendingByNota.values())
        const pendingByDestino = new Map<string, string[]>()

        for (const item of pendingList) {
          const notaIds = pendingByDestino.get(item.administradorDestinoId) ?? []
          notaIds.push(item.notaId)
          pendingByDestino.set(item.administradorDestinoId, notaIds)
        }

        let movedCount = 0
        for (const [administradorDestinoId, notaIds] of pendingByDestino.entries()) {
          const chunks = chunkArray(Array.from(new Set(notaIds)), REASSIGN_CHUNK_SIZE)

          for (const notaIdsChunk of chunks) {
            const { data, error } = await supabase.rpc('reatribuir_ordens_selecionadas', {
              p_nota_ids: notaIdsChunk,
              p_gestor_id: loggedAdmin.id,
              p_modo: 'destino_unico',
              p_admin_destino: administradorDestinoId,
              p_motivo: 'Auto realocação por unidade (Painel de Ordens)',
            })

            if (error) throw error
            movedCount += ((data ?? []) as Array<{ nota_id: string }>).length
          }
        }

        if (debugCdRouting) {
          console.log('[DEBUG orders/cd-routing] detectadas_por_unidade:', JSON.stringify(detectedByUnit))
          console.log('[DEBUG orders/cd-routing] notas_pendentes:', pendingList.length)
          console.log('[DEBUG orders/cd-routing] notas_com_conflito:', conflictNotaIds.size)
          console.log('[DEBUG orders/cd-routing] notas_reatribuidas:', movedCount)
          console.log(
            '[DEBUG orders/cd-routing] amostra_reatribuicoes:',
            JSON.stringify(
              pendingList.slice(0, 5).map((item) => ({
                ordem_codigo: item.ordemCodigo,
                unidade: item.unidade,
                responsavel_anterior: item.responsavelAnteriorNome ?? item.responsavelAnteriorId,
                responsavel_novo: item.responsavelNovoNome,
              }))
            )
          )
        }
      } else if (debugCdRouting) {
        console.warn('[DEBUG orders/cd-routing] owners fixos não disponíveis em administradores; realocação automática ignorada')
      }
    } catch (error) {
      console.error('[orders/cd-routing] falha ao aplicar realocação automática:', error)
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

  const GUSTAVO_EMAIL = 'gustavoandrade@bemol.com.br'
  let tipoOrdem = normalizeTipoOrdem(searchParams.get('tipoOrdem'))
  if (tipoOrdem === 'PMPL' && user.email !== GUSTAVO_EMAIL) {
    tipoOrdem = null
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

  const fixedOwnerLabelByAdminId = new Map<string, string>()
  for (const key of Object.keys(fixedOwnerByKey) as FixedOwnerKey[]) {
    const owner = fixedOwnerByKey[key]
    if (!owner) continue
    fixedOwnerLabelByAdminId.set(owner.id, FIXED_OWNER_LABEL_BY_KEY[key])
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

  // DEBUG: remover após validar que em_avaliacao e avaliadas retornam valores corretos
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
    },
  }

  return NextResponse.json(response)
}
