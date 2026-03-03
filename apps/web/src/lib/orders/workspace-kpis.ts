import type { OrdemNotaAcompanhamento, OrdersWorkspaceKpis } from '@/lib/types/database'

const RAW_STATUS_EM_AVALIACAO = new Set(['AVALIACAO_DA_EXECUCAO', 'AVALIACAO_DE_EXECUCAO'])
const RAW_STATUS_AVALIADA = new Set(['EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA'])

export function emptyWorkspaceKpis(): OrdersWorkspaceKpis {
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

export function normalizeWorkspaceRawStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

export function isWorkspaceOrderEmAvaliacao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return RAW_STATUS_EM_AVALIACAO.has(normalizeWorkspaceRawStatus(row.status_ordem_raw))
}

export function isWorkspaceOrderAvaliada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return RAW_STATUS_AVALIADA.has(normalizeWorkspaceRawStatus(row.status_ordem_raw))
}

export function isWorkspaceOrderNaoRealizada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeWorkspaceRawStatus(row.status_ordem_raw) === 'EXECUCAO_NAO_REALIZADA'
}

export function isWorkspaceOrderEmProcessamento(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeWorkspaceRawStatus(row.status_ordem_raw) === 'EM_PROCESSAMENTO'
}

export function isWorkspaceOrderEmExecucao(
  row: Pick<OrdemNotaAcompanhamento, 'status_ordem' | 'status_ordem_raw'>
): boolean {
  const inExecutionStatus = row.status_ordem === 'em_tratativa' || row.status_ordem === 'desconhecido'
  if (!inExecutionStatus) return false
  return !isWorkspaceOrderEmAvaliacao(row) && !isWorkspaceOrderNaoRealizada(row) && !isWorkspaceOrderEmProcessamento(row)
}

export function recomputeWorkspaceKpisFromRows(rows: OrdemNotaAcompanhamento[]): OrdersWorkspaceKpis {
  return {
    total: rows.length,
    abertas: rows.filter((row) => row.status_ordem === 'aberta').length,
    em_tratativa: rows.filter((row) => isWorkspaceOrderEmExecucao(row)).length,
    em_avaliacao: rows.filter((row) => isWorkspaceOrderEmAvaliacao(row)).length,
    concluidas: rows.filter((row) => row.status_ordem === 'concluida' && !isWorkspaceOrderAvaliada(row)).length,
    canceladas: rows.filter((row) => row.status_ordem === 'cancelada').length,
    avaliadas: rows.filter((row) => isWorkspaceOrderAvaliada(row)).length,
    atrasadas: rows.filter((row) => (
      row.semaforo_atraso === 'vermelho'
      && (row.status_ordem === 'aberta' || isWorkspaceOrderEmExecucao(row) || isWorkspaceOrderEmAvaliacao(row))
    )).length,
    sem_responsavel: rows.filter((row) => !row.responsavel_atual_id).length,
  }
}
