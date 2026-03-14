import { describe, expect, it } from 'vitest'
import { buildMonthlyEvolution, buildRanking } from './financeiro-data'
import type { FinanceiroOrdemRow } from '@/lib/types/database'

const baseRow: FinanceiroOrdemRow = {
  id: '1',
  ordem_codigo: '5001',
  tipo_ordem: 'PMOS',
  numero_nota: null,
  data_entrada: '2026-01-10',
  denominacao_unidade: 'Loja Centro',
  texto_breve: 'Servico A',
  fornecedor_codigo: '123',
  fornecedor_nome: 'Fornecedor A',
  custos_estimados: 0,
  custos_totais_materiais: 20,
  custos_adicionais: 0,
  custos_totais_reais: 100,
  competencia_ano: 2026,
  competencia_mes: 1,
  valor_realizado: 100,
  valor_previsto_pendente: 0,
  tem_custo_real: true,
  valor_servico_calculado: 80,
  source_file_name: 'pmos.xlsx',
  imported_by: 'admin-1',
  importado_em: '2026-03-14T10:00:00.000Z',
  created_at: '2026-03-14T10:00:00.000Z',
  updated_at: '2026-03-14T10:00:00.000Z',
}

describe('financeiro-data', () => {
  it('separa gasto realizado de compromisso total na evolucao mensal', () => {
    const rows = buildMonthlyEvolution([
      baseRow,
      {
        ...baseRow,
        id: '2',
        ordem_codigo: '5002',
        custos_totais_reais: 0,
        valor_realizado: 0,
        valor_previsto_pendente: 50,
        tem_custo_real: false,
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      realizado: 100,
      previsto_pendente: 50,
      total_gasto: 100,
      compromisso_total: 150,
    })
  })

  it('ordena ranking por gasto realizado e preserva compromisso separado', () => {
    const ranking = buildRanking([
      baseRow,
      {
        ...baseRow,
        id: '3',
        ordem_codigo: '5003',
        denominacao_unidade: 'Loja Norte',
        custos_totais_reais: 0,
        valor_realizado: 0,
        valor_previsto_pendente: 500,
        tem_custo_real: false,
      },
    ], (row) => row.denominacao_unidade ?? 'Sem unidade', 10)

    expect(ranking[0]).toMatchObject({
      nome: 'Loja Centro',
      total_gasto: 100,
      compromisso_total: 140,
    })
    expect(ranking[1]).toMatchObject({
      nome: 'Loja Norte',
      total_gasto: 0,
      compromisso_total: 500,
    })
  })
})
