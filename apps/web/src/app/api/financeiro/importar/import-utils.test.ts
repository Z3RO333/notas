import { describe, expect, it } from 'vitest'
import {
  buildReplacementScopes,
  getCompetenciaDate,
  normalizeFinanceiroRow,
  resolveValorPrevistoPendente,
} from './import-utils'

describe('import-utils', () => {
  it('usa fallback de PMPL para data_entrada quando inicio_programado estiver nulo', () => {
    expect(getCompetenciaDate('PMOS', '2026-03-01', '2026-03-10')).toBe('2026-03-01')
    expect(getCompetenciaDate('PMPL', '2026-03-01', '2026-03-10')).toBe('2026-03-10')
    expect(getCompetenciaDate('PMPL', '2026-03-01', null)).toBe('2026-03-01')
  })

  it('faz valor total prevalecer e zerar o pendente', () => {
    expect(resolveValorPrevistoPendente(907641.38, 931806.27, 283454.77)).toBe(0)
  })

  it('usa o maior entre estimado e material quando nao houver valor total', () => {
    expect(resolveValorPrevistoPendente(0, 500, 90)).toBe(500)
    expect(resolveValorPrevistoPendente(0, 120, 180)).toBe(180)
    expect(resolveValorPrevistoPendente(0, 500, 520)).toBe(520)
  })

  it('normaliza PMPL sem inicio_programado quando data_entrada existir', () => {
    const normalized = normalizeFinanceiroRow({
      rowIndex: 8,
      ordem_codigo: '5223001',
      tipo_ordem: 'PMPL',
      numero_nota: null,
      data_entrada: '2026-03-01',
      inicio_programado: null,
      denominacao_unidade: 'Loja Centro',
      texto_breve: 'Preventiva',
      fornecedor_codigo: '123',
      fornecedor_nome: 'Fornecedor A',
      custos_estimados: 500,
      custos_totais_materiais: 90,
      custos_adicionais: 0,
      custos_totais_reais: 0,
    }, 'pmpl.xlsx', 'admin-1', '2026-03-13T12:00:00.000Z')

    expect(normalized.error).toBeNull()
    expect(normalized.payload?.data_entrada).toBe('2026-03-01')
    expect(normalized.payload?.inicio_programado).toBeNull()
  })

  it('gera escopos por tipo com base na competencia efetiva', () => {
    const scopes = buildReplacementScopes([
      {
        ordem_codigo: '1',
        tipo_ordem: 'PMOS',
        numero_nota: null,
        data_entrada: '2026-01-05',
        inicio_programado: null,
        denominacao_unidade: null,
        texto_breve: null,
        fornecedor_codigo: null,
        fornecedor_nome: null,
        custos_estimados: 0,
        custos_totais_materiais: 0,
        custos_adicionais: 0,
        custos_totais_reais: 10,
        source_file_name: 'pmos.xlsx',
        imported_by: 'admin-1',
        importado_em: '2026-03-13T12:00:00.000Z',
        updated_at: '2026-03-13T12:00:00.000Z',
        raw_payload: {},
      },
      {
        ordem_codigo: '2',
        tipo_ordem: 'PMOS',
        numero_nota: null,
        data_entrada: '2026-12-28',
        inicio_programado: null,
        denominacao_unidade: null,
        texto_breve: null,
        fornecedor_codigo: null,
        fornecedor_nome: null,
        custos_estimados: 0,
        custos_totais_materiais: 0,
        custos_adicionais: 0,
        custos_totais_reais: 10,
        source_file_name: 'pmos.xlsx',
        imported_by: 'admin-1',
        importado_em: '2026-03-13T12:00:00.000Z',
        updated_at: '2026-03-13T12:00:00.000Z',
        raw_payload: {},
      },
      {
        ordem_codigo: '3',
        tipo_ordem: 'PMPL',
        numero_nota: null,
        data_entrada: '2026-01-02',
        inicio_programado: '2026-02-10',
        denominacao_unidade: null,
        texto_breve: null,
        fornecedor_codigo: null,
        fornecedor_nome: null,
        custos_estimados: 0,
        custos_totais_materiais: 0,
        custos_adicionais: 0,
        custos_totais_reais: 10,
        source_file_name: 'pmpl.xlsx',
        imported_by: 'admin-1',
        importado_em: '2026-03-13T12:00:00.000Z',
        updated_at: '2026-03-13T12:00:00.000Z',
        raw_payload: {},
      },
      {
        ordem_codigo: '4',
        tipo_ordem: 'PMPL',
        numero_nota: null,
        data_entrada: '2027-02-28',
        inicio_programado: null,
        denominacao_unidade: null,
        texto_breve: null,
        fornecedor_codigo: null,
        fornecedor_nome: null,
        custos_estimados: 0,
        custos_totais_materiais: 0,
        custos_adicionais: 0,
        custos_totais_reais: 10,
        source_file_name: 'pmpl.xlsx',
        imported_by: 'admin-1',
        importado_em: '2026-03-13T12:00:00.000Z',
        updated_at: '2026-03-13T12:00:00.000Z',
        raw_payload: {},
      },
    ])

    expect(scopes).toEqual([
      {
        tipo_ordem: 'PMOS',
        competencia_inicio: '2026-01-05',
        competencia_fim: '2026-12-28',
      },
      {
        tipo_ordem: 'PMPL',
        competencia_inicio: '2026-02-10',
        competencia_fim: '2027-02-28',
      },
    ])
  })
})
