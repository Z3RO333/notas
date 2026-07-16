import type { OrdemNotaAcompanhamento, OrdersWorkspaceKpis } from '@/lib/types/database'
import {
  isRawOrderActive,
  isRawOrderAguardandoFaturamento,
  isRawOrderAvaliada,
  isRawOrderCancelada,
  isRawOrderConcluida,
  isRawOrderEmAberto,
  isRawOrderEmAvaliacao,
  isRawOrderEmExecucao,
  isRawOrderNaoRealizada,
  normalizeRawStatus,
} from '@/lib/orders/status-raw'

export function emptyWorkspaceKpis(): OrdersWorkspaceKpis {
  return {
    total: 0,
    abertas: 0,
    em_tratativa: 0,
    em_avaliacao: 0,
    concluidas: 0,
    canceladas: 0,
    avaliadas: 0,
    aguardando_faturamento: 0,
    atrasadas: 0,
    sem_responsavel: 0,
  }
}

export function normalizeWorkspaceRawStatus(value: string | null | undefined): string {
  return normalizeRawStatus(value)
}

export function isWorkspaceOrderEmAvaliacao(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return isRawOrderEmAvaliacao(row.status_ordem_raw)
}

export function isWorkspaceOrderAvaliada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return isRawOrderAvaliada(row.status_ordem_raw)
}

export function isWorkspaceOrderNaoRealizada(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return isRawOrderNaoRealizada(row.status_ordem_raw)
}

export function isWorkspaceOrderEmProcessamento(row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>): boolean {
  return normalizeRawStatus(row.status_ordem_raw) === 'EM_PROCESSAMENTO'
}

export function isWorkspaceOrderEmExecucao(
  row: Pick<OrdemNotaAcompanhamento, 'status_ordem_raw'>
): boolean {
  return isRawOrderEmExecucao(row.status_ordem_raw)
}

export function recomputeWorkspaceKpisFromRows(rows: OrdemNotaAcompanhamento[]): OrdersWorkspaceKpis {
  return {
    total: rows.length,
    abertas: rows.filter((row) => isRawOrderEmAberto(row.status_ordem_raw)).length,
    em_tratativa: rows.filter((row) => isWorkspaceOrderEmExecucao(row)).length,
    em_avaliacao: rows.filter((row) => isWorkspaceOrderEmAvaliacao(row)).length,
    concluidas: rows.filter((row) => isRawOrderConcluida(row.status_ordem_raw)).length,
    canceladas: rows.filter((row) => isRawOrderCancelada(row.status_ordem_raw)).length,
    avaliadas: rows.filter((row) => isWorkspaceOrderAvaliada(row)).length,
    aguardando_faturamento: rows.filter((row) => isRawOrderAguardandoFaturamento(row.status_ordem_raw)).length,
    atrasadas: rows.filter((row) => row.semaforo_atraso === 'vermelho' && isRawOrderActive(row.status_ordem_raw)).length,
    sem_responsavel: rows.filter((row) => !row.responsavel_atual_id && isRawOrderActive(row.status_ordem_raw)).length,
  }
}
