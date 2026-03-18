import { describe, expect, it } from 'vitest'
import {
  buildNotesEmCampoConsolidationMessage,
  buildNotesEmCampoData,
  inferNotesEmCampoService,
  pickNotesEmCampoSuggestionTarget,
  rankNotesEmCampoOperationalSuggestions,
} from '@/lib/notes/em-campo'
import type { NotesEmCampoOperationalSuggestion } from '@/lib/types/database'

const operationals: NotesEmCampoOperationalSuggestion[] = [
  {
    fornecedor_codigo: '22578',
    fornecedor_nome: 'CLAUDIOMAR LOPES DA SILVA',
    total_em_campo: 3,
    ordens_mesma_loja_ativas: 1,
    historico_loja_servico: 4,
    historico_servico_geral: 8,
    match_mode: 'exato',
  },
  {
    fornecedor_codigo: '22016',
    fornecedor_nome: 'EDESON MONTEIRO SOUSA',
    total_em_campo: 1,
    ordens_mesma_loja_ativas: 0,
    historico_loja_servico: 5,
    historico_servico_geral: 10,
    match_mode: 'exato',
  },
  {
    fornecedor_codigo: '10262',
    fornecedor_nome: 'OTAVIO LUIS MEDEIROS DE AZEVEDO',
    total_em_campo: 0,
    ordens_mesma_loja_ativas: 0,
    historico_loja_servico: 0,
    historico_servico_geral: 2,
    match_mode: 'fallback_servico',
  },
]

describe('buildNotesEmCampoData', () => {
  it('prioriza quem ja atende a mesma loja antes do restante', () => {
    const ranked = rankNotesEmCampoOperationalSuggestions(operationals)

    expect(ranked[0]).toMatchObject({
      fornecedor_codigo: '22578',
      ordens_mesma_loja_ativas: 1,
    })
  })

  it('mantem a dica de eletrica orientada a consolidacao operacional', () => {
    const data = buildNotesEmCampoData({
      service: 'INSTALACAO ELETRICA',
      operationals,
    })

    expect(data.hint.prioridade).toBe('interno')
    expect(data.hint.mensagem).toContain('operacional')
    expect(data.operacionais[0]?.fornecedor_codigo).toBe('22578')
  })

  it('infer the closest service from note description', () => {
    expect(inferNotesEmCampoService(
      'AR CONDICIONADO (ATE 60.000 BTUS)',
      ['INSTALACAO ELETRICA', 'AR CONDICIONADO', 'CONTROLE DE PRAGA'],
    )).toBe('AR CONDICIONADO')
  })

  it('uses the operational already active in the same store as the main target', () => {
    const target = pickNotesEmCampoSuggestionTarget({
      suggestions: operationals,
    })

    expect(target).toMatchObject({
      tipo: 'operacional',
      nome: 'CLAUDIOMAR LOPES DA SILVA',
      ordens_mesma_loja_ativas: 1,
    })
  })

  it('returns null when there is no operational suggestion', () => {
    const target = pickNotesEmCampoSuggestionTarget({
      suggestions: [],
    })

    expect(target).toBeNull()
  })

  it('builds a consolidation message when someone already atende a loja', () => {
    const target = pickNotesEmCampoSuggestionTarget({ suggestions: operationals })

    expect(buildNotesEmCampoConsolidationMessage({
      loja: 'Loja Manacapuru',
      target,
    })).toBe('CLAUDIOMAR LOPES DA SILVA ja tem 1 ordem em Loja Manacapuru. Vale consolidar esta nota com ele.')
  })
})
