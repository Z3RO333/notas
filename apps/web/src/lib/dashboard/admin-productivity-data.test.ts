import { describe, expect, it } from 'vitest'
import {
  isMissingAdminProductivityPayloadRpc,
  normalizeAdminProductivityDashboardPayload,
  normalizeFornecedorCodigo,
  pickOperationalAvatarCodes,
} from './admin-productivity-data'

describe('admin-productivity-data', () => {
  it('normalizes the consolidated admin payload and fills missing months with zero', () => {
    const result = normalizeAdminProductivityDashboardPayload(
      {
        current_kpis: {
          total: 18,
          abertas: 4,
          em_tratativa: 3,
          em_avaliacao: 1,
          concluidas: 9,
          canceladas: 1,
          avaliadas: 0,
          atrasadas: 2,
          sem_responsavel: 1,
        },
        previous_kpis: {
          total: 10,
          concluidas: 6,
        },
        current_ranking: [
          {
            administrador_id: 'admin-1',
            nome: 'Paula',
            qtd_ordens_30d: 10,
            qtd_concluidas_30d: 7,
          },
        ],
        monthly_evolution: [
          { ano: 2026, mes: 2, concluidas: 5, em_aberto: 2 },
          { ano: 2026, mes: 3, concluidas: 9, em_aberto: 4 },
        ],
      },
      [
        {
          year: 2026,
          month: 1,
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          startIso: '2026-01-01T00:00:00.000Z',
          endExclusiveIso: '2026-02-01T00:00:00.000Z',
          label: 'Jan/2026',
        },
        {
          year: 2026,
          month: 2,
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          startIso: '2026-02-01T00:00:00.000Z',
          endExclusiveIso: '2026-03-01T00:00:00.000Z',
          label: 'Fev/2026',
        },
        {
          year: 2026,
          month: 3,
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          startIso: '2026-03-01T00:00:00.000Z',
          endExclusiveIso: '2026-04-01T00:00:00.000Z',
          label: 'Mar/2026',
        },
      ],
    )

    expect(result.currentKpis.total).toBe(18)
    expect(result.previousKpis.total).toBe(10)
    expect(result.currentRanking).toHaveLength(1)
    expect(result.currentRanking[0]?.nome).toBe('Paula')
    expect(result.evolution).toEqual([
      { ano: 2026, mes: 1, label: 'Jan/2026', concluidas: 0, em_aberto: 0 },
      { ano: 2026, mes: 2, label: 'Fev/2026', concluidas: 5, em_aberto: 2 },
      { ano: 2026, mes: 3, label: 'Mar/2026', concluidas: 9, em_aberto: 4 },
    ])
  })

  it('normalizes supplier codes and deduplicates avatar lookups', () => {
    expect(normalizeFornecedorCodigo('10261 - FRANCISCO')).toBe('10261')
    expect(normalizeFornecedorCodigo('  22016  ')).toBe('22016')

    expect(
      pickOperationalAvatarCodes([
        {
          fornecedor_codigo: '10261 - FRANCISCO',
          fornecedor_nome: 'Francisco',
          total_ordens: 10,
          atendidas: 8,
          em_aberto: 2,
          lojas_atendidas: 4,
          pct_conclusao: 80,
        },
        {
          fornecedor_codigo: '10261',
          fornecedor_nome: 'Francisco',
          total_ordens: 6,
          atendidas: 4,
          em_aberto: 2,
          lojas_atendidas: 3,
          pct_conclusao: 66.7,
        },
        {
          fornecedor_codigo: '22578',
          fornecedor_nome: 'Claudiomar',
          total_ordens: 5,
          atendidas: 5,
          em_aberto: 0,
          lojas_atendidas: 2,
          pct_conclusao: 100,
        },
      ]),
    ).toEqual(['10261', '22578'])
  })

  it('detects when the consolidated rpc is not available yet', () => {
    expect(
      isMissingAdminProductivityPayloadRpc({
        code: 'PGRST202',
        message: 'function not found',
      }),
    ).toBe(true)

    expect(
      isMissingAdminProductivityPayloadRpc({
        code: 'XX000',
        message: 'calcular_dashboard_produtividade_admin does not exist',
      }),
    ).toBe(true)

    expect(
      isMissingAdminProductivityPayloadRpc({
        code: '42725',
        message: 'some other function is not unique',
      }),
    ).toBe(false)
  })
})
