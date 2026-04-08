import { describe, expect, it, vi } from 'vitest'
import { fetchAllFilteredOrderCodes } from '@/lib/orders/workspace-copy'
import type {
  OrdersWorkspaceCursor,
  OrdersWorkspaceFilters,
  OrdersWorkspaceResponse,
  OrdemNotaAcompanhamento,
} from '@/lib/types/database'

const baseFilters: OrdersWorkspaceFilters = {
  periodMode: 'range',
  year: 2026,
  month: 3,
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  q: 'avenida',
  status: 'em_tratativa',
  responsavel: 'todos',
  unidade: 'AVENIDA',
  prioridade: 'vermelho',
  tipoOrdem: 'PMOS',
}

function makeRow(overrides: Partial<OrdemNotaAcompanhamento> = {}): OrdemNotaAcompanhamento {
  return {
    ordem_id: overrides.ordem_id ?? '11111111-1111-4111-8111-111111111111',
    nota_id: overrides.nota_id ?? 'nota-1',
    numero_nota: overrides.numero_nota ?? '1000',
    ordem_codigo: overrides.ordem_codigo ?? '5224001',
    administrador_id: overrides.administrador_id ?? null,
    administrador_nome: overrides.administrador_nome ?? null,
    responsavel_atual_id: overrides.responsavel_atual_id ?? null,
    responsavel_atual_nome: overrides.responsavel_atual_nome ?? null,
    centro: overrides.centro ?? '103',
    unidade: overrides.unidade ?? 'AVENIDA',
    status_ordem: overrides.status_ordem ?? 'aberta',
    status_ordem_raw: overrides.status_ordem_raw ?? 'EM_EXECUCAO',
    ordem_detectada_em: overrides.ordem_detectada_em ?? '2026-03-03T10:00:00.000Z',
    status_atualizado_em: overrides.status_atualizado_em ?? '2026-03-03T10:05:00.000Z',
    dias_para_gerar_ordem: overrides.dias_para_gerar_ordem ?? 1,
    qtd_historico: overrides.qtd_historico ?? 0,
    tem_historico: overrides.tem_historico ?? false,
    dias_em_aberto: overrides.dias_em_aberto ?? 2,
    semaforo_atraso: overrides.semaforo_atraso ?? 'verde',
    envolvidos_admin_ids: overrides.envolvidos_admin_ids ?? [],
    descricao: overrides.descricao ?? 'Teste',
    tipo_ordem: overrides.tipo_ordem ?? 'PMOS',
  }
}

function makePayload(
  rows: OrdemNotaAcompanhamento[],
  nextCursor: OrdersWorkspaceCursor | null,
): OrdersWorkspaceResponse {
  return {
    rows,
    nextCursor,
    unitOptions: [],
    kpis: {
      total: rows.length,
      abertas: 0,
      em_tratativa: rows.length,
      em_avaliacao: 0,
      concluidas: 0,
      canceladas: 0,
      avaliadas: 0,
      atrasadas: 0,
      sem_responsavel: 0,
    },
    ownerSummary: [],
    reassignTargets: [],
    poolGroups: [],
    poolCentros: {},
    currentUser: {
      role: 'gestor',
      adminId: 'gestor-1',
      canViewGlobal: true,
      canAccessPmpl: true,
    },
  }
}

describe('workspace-copy', () => {
  it('pagina até o fim do filtro atual e coleta apenas códigos válidos', async () => {
    const nextCursor = {
      ordem_detectada_em: '2026-03-03T10:00:00.000Z',
      ordem_id: '22222222-2222-4222-8222-222222222222',
    }

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePayload([
          makeRow({ ordem_id: '1', nota_id: 'nota-1', ordem_codigo: '5224003' }),
          makeRow({ ordem_id: '2', nota_id: 'nota-2', ordem_codigo: '   ' }),
        ], nextCursor),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePayload([
          makeRow({ ordem_id: '3', nota_id: 'nota-3', ordem_codigo: '5224004' }),
        ], null),
      })

    const result = await fetchAllFilteredOrderCodes(baseFilters, {
      developerViewRole: 'gestor',
      fetchImpl,
    })

    expect(result.codes).toEqual(['5224003', '5224004'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/api/ordens/copy?')
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('devViewAs=gestor')
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('unidade=AVENIDA')
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('cursorOrdemId=22222222-2222-4222-8222-222222222222')
  })

  it('propaga a mensagem do backend quando a busca falha', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'erro do workspace' }),
    })

    await expect(fetchAllFilteredOrderCodes(baseFilters, { fetchImpl }))
      .rejects
      .toThrow('erro do workspace')
  })
})
