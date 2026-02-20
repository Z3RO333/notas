import type {
  CriticalityLevel,
  OrdemKpisRpc,
  OrdersKpiFilter,
  OrderWindowFilter,
  OrdemNotaAcompanhamento,
  OrdemNotaKpis,
  OrdemNotaRankingAdmin,
  OrdemNotaRankingUnidade,
  OrdemStatusAcomp,
} from '@/lib/types/database'

const FINAL_STATUS = new Set<OrdemStatusAcomp>(['concluida', 'cancelada'])
const RAW_STATUS = {
  emAvaliacao: 'AVALIACAO_DA_EXECUCAO',
  avaliada: 'EXECUCAO_SATISFATORIO',
  naoRealizada: 'EXECUCAO_NAO_REALIZADA',
} as const

function toWindow(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 30
}

export function parseOrderWindow(value: unknown): OrderWindowFilter {
  const parsed = toWindow(value)
  if (parsed === 90 || parsed === 180) return parsed
  return 30
}

export function buildOrderKpis(rows: OrdemNotaAcompanhamento[]): OrdemNotaKpis {
  const total = rows.length
  const abertas = rows.filter((row) => row.status_ordem === 'aberta').length
  const emTratativa = rows.filter((row) => isEmExecucao(row)).length
  const emAvaliacao = rows.filter((row) => isEmAvaliacao(row)).length
  const concluidas = rows.filter((row) => row.status_ordem === 'concluida' && !isAvaliada(row)).length
  const canceladas = rows.filter((row) => row.status_ordem === 'cancelada').length
  const avaliadas = rows.filter((row) => isAvaliada(row)).length
  const antigas = rows.filter((row) => (
    row.semaforo_atraso === 'vermelho'
    && (row.status_ordem === 'aberta' || isEmExecucao(row) || isEmAvaliacao(row))
  )).length

  const tempos = rows
    .map((row) => row.dias_para_gerar_ordem)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const media = tempos.length > 0
    ? Number((tempos.reduce((sum, value) => sum + value, 0) / tempos.length).toFixed(2))
    : null

  return {
    total_ordens_30d: total,
    qtd_abertas_30d: abertas,
    qtd_em_tratativa_30d: emTratativa,
    qtd_em_avaliacao_30d: emAvaliacao,
    qtd_concluidas_30d: concluidas,
    qtd_canceladas_30d: canceladas,
    qtd_avaliadas_30d: avaliadas,
    qtd_antigas_7d_30d: antigas,
    tempo_medio_geracao_dias_30d: media,
  }
}

export function buildOrderKpisFromRpc(rpc: OrdemKpisRpc): OrdemNotaKpis {
  return {
    total_ordens_30d: rpc.total,
    qtd_abertas_30d: rpc.abertas,
    qtd_em_tratativa_30d: rpc.em_tratativa,
    qtd_em_avaliacao_30d: rpc.em_avaliacao,
    qtd_concluidas_30d: rpc.concluidas,
    qtd_canceladas_30d: rpc.canceladas,
    qtd_avaliadas_30d: rpc.avaliadas,
    qtd_antigas_7d_30d: rpc.atrasadas_7d,
    tempo_medio_geracao_dias_30d: null,
  }
}

function normalizeRawStatus(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): string {
  return (row.status_ordem_raw ?? '').trim().toUpperCase()
}

export function isEmAvaliacao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row) === RAW_STATUS.emAvaliacao
}

export function isAvaliada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row) === RAW_STATUS.avaliada
}

export function isNaoRealizada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row) === RAW_STATUS.naoRealizada
}

function isEmExecucao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem' | 'status_ordem_raw'>): boolean {
  const inExecutionStatus = row.status_ordem === 'em_tratativa' || row.status_ordem === 'desconhecido'
  if (!inExecutionStatus) return false
  return !isEmAvaliacao(row) && !isNaoRealizada(row)
}

export function getOrdersCriticalityLevel(total: number, criticalCount: number): CriticalityLevel {
  if (total <= 0 || criticalCount <= 0) return 'saudavel'

  const ratio = criticalCount / Math.max(total, 1)

  if (criticalCount >= 20 || ratio >= 0.35) return 'critico'
  if (criticalCount >= 6 || ratio >= 0.15) return 'atencao'
  return 'saudavel'
}

export function getOrdersKpiValue(kpis: OrdemNotaKpis, key: OrdersKpiFilter): number {
  if (key === 'em_execucao') return kpis.qtd_em_tratativa_30d
  if (key === 'em_aberto') return kpis.qtd_abertas_30d
  if (key === 'em_avaliacao') return kpis.qtd_em_avaliacao_30d
  if (key === 'avaliadas') return kpis.qtd_avaliadas_30d
  if (key === 'atrasadas') return kpis.qtd_antigas_7d_30d
  if (key === 'concluidas') return kpis.qtd_concluidas_30d + kpis.qtd_canceladas_30d
  return kpis.total_ordens_30d
}

export function matchOrdersKpi(row: OrdemNotaAcompanhamento, key: OrdersKpiFilter): boolean {
  if (key === 'em_execucao') return isEmExecucao(row)
  if (key === 'em_aberto') return row.status_ordem === 'aberta'
  if (key === 'em_avaliacao') return isEmAvaliacao(row)
  if (key === 'avaliadas') return isAvaliada(row)
  if (key === 'atrasadas') {
    return row.semaforo_atraso === 'vermelho'
      && (row.status_ordem === 'aberta' || isEmExecucao(row) || isEmAvaliacao(row))
  }
  if (key === 'concluidas') {
    return (row.status_ordem === 'concluida' && !isAvaliada(row)) || row.status_ordem === 'cancelada'
  }
  return true
}

export function buildOrderRankingAdmin(rows: OrdemNotaAcompanhamento[]): OrdemNotaRankingAdmin[] {
  const grouped = new Map<string, OrdemNotaRankingAdmin>()

  for (const row of rows) {
    if (!row.administrador_id) continue

    const current = grouped.get(row.administrador_id) ?? {
      administrador_id: row.administrador_id,
      nome: row.administrador_nome ?? 'Sem nome',
      qtd_ordens_30d: 0,
      qtd_abertas_30d: 0,
      qtd_em_tratativa_30d: 0,
      qtd_concluidas_30d: 0,
      qtd_canceladas_30d: 0,
      qtd_antigas_7d_30d: 0,
      tempo_medio_geracao_dias_30d: null,
    }

    current.qtd_ordens_30d += 1
    if (row.status_ordem === 'aberta') current.qtd_abertas_30d += 1
    if (row.status_ordem === 'em_tratativa') current.qtd_em_tratativa_30d += 1
    if (row.status_ordem === 'concluida') current.qtd_concluidas_30d += 1
    if (row.status_ordem === 'cancelada') current.qtd_canceladas_30d += 1
    if (row.semaforo_atraso === 'vermelho') current.qtd_antigas_7d_30d += 1

    grouped.set(row.administrador_id, current)
  }

  const result = [...grouped.values()].map((row) => {
    const tempos = rows
      .filter((item) => item.administrador_id === row.administrador_id)
      .map((item) => item.dias_para_gerar_ordem)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    return {
      ...row,
      tempo_medio_geracao_dias_30d: tempos.length > 0
        ? Number((tempos.reduce((sum, value) => sum + value, 0) / tempos.length).toFixed(2))
        : null,
    }
  })

  return result.sort((a, b) => {
    if (b.qtd_ordens_30d !== a.qtd_ordens_30d) return b.qtd_ordens_30d - a.qtd_ordens_30d
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

export function buildOrderRankingUnidade(rows: OrdemNotaAcompanhamento[]): OrdemNotaRankingUnidade[] {
  const grouped = new Map<string, OrdemNotaRankingUnidade>()

  for (const row of rows) {
    const unidade = row.unidade ?? 'Sem unidade'
    const current = grouped.get(unidade) ?? {
      unidade,
      qtd_ordens_30d: 0,
      qtd_abertas_30d: 0,
      qtd_em_tratativa_30d: 0,
      qtd_antigas_7d_30d: 0,
      tempo_medio_geracao_dias_30d: null,
    }

    current.qtd_ordens_30d += 1
    if (row.status_ordem === 'aberta') current.qtd_abertas_30d += 1
    if (row.status_ordem === 'em_tratativa') current.qtd_em_tratativa_30d += 1
    if (row.semaforo_atraso === 'vermelho') current.qtd_antigas_7d_30d += 1

    grouped.set(unidade, current)
  }

  const result = [...grouped.values()].map((row) => {
    const tempos = rows
      .filter((item) => (item.unidade ?? 'Sem unidade') === row.unidade)
      .map((item) => item.dias_para_gerar_ordem)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    return {
      ...row,
      tempo_medio_geracao_dias_30d: tempos.length > 0
        ? Number((tempos.reduce((sum, value) => sum + value, 0) / tempos.length).toFixed(2))
        : null,
    }
  })

  return result.sort((a, b) => {
    if (b.qtd_ordens_30d !== a.qtd_ordens_30d) return b.qtd_ordens_30d - a.qtd_ordens_30d
    return a.unidade.localeCompare(b.unidade, 'pt-BR')
  })
}

export function sortOrdersByPriority(rows: OrdemNotaAcompanhamento[]): OrdemNotaAcompanhamento[] {
  const scoreBySemaforo: Record<OrdemNotaAcompanhamento['semaforo_atraso'], number> = {
    vermelho: 3,
    amarelo: 2,
    verde: 1,
    neutro: 0,
  }

  return [...rows].sort((a, b) => {
    if (a.semaforo_atraso !== b.semaforo_atraso) {
      return scoreBySemaforo[b.semaforo_atraso] - scoreBySemaforo[a.semaforo_atraso]
    }

    const aOpen = FINAL_STATUS.has(a.status_ordem) ? 0 : 1
    const bOpen = FINAL_STATUS.has(b.status_ordem) ? 0 : 1
    if (aOpen !== bOpen) return bOpen - aOpen

    const aDate = Date.parse(a.ordem_detectada_em)
    const bDate = Date.parse(b.ordem_detectada_em)
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
      return bDate - aDate
    }

    return a.ordem_codigo.localeCompare(b.ordem_codigo)
  })
}

export function getOrderStatusLabel(status: OrdemStatusAcomp): string {
  if (status === 'aberta') return 'Aberta'
  if (status === 'em_tratativa') return 'Em tratativa'
  if (status === 'concluida') return 'Concluída'
  if (status === 'cancelada') return 'Cancelada'
  return 'Desconhecido'
}

export function getOrderStatusClass(status: OrdemStatusAcomp): string {
  if (status === 'aberta') return 'bg-sky-100 text-sky-700'
  if (status === 'em_tratativa') return 'bg-indigo-100 text-indigo-700'
  if (status === 'concluida') return 'bg-emerald-100 text-emerald-700'
  if (status === 'cancelada') return 'bg-slate-100 text-slate-600'
  return 'bg-amber-100 text-amber-700'
}

export function getSemaforoClass(semaforo: OrdemNotaAcompanhamento['semaforo_atraso']): string {
  if (semaforo === 'vermelho') return 'bg-red-100 text-red-700'
  if (semaforo === 'amarelo') return 'bg-amber-100 text-amber-700'
  if (semaforo === 'verde') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

export function getSemaforoLabel(semaforo: OrdemNotaAcompanhamento['semaforo_atraso']): string {
  if (semaforo === 'vermelho') return 'Atrasada'
  if (semaforo === 'amarelo') return 'Atenção'
  if (semaforo === 'verde') return 'Recente'
  return 'Neutro'
}
