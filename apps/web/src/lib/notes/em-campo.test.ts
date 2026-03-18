import { describe, expect, it } from 'vitest'
import {
  buildNotesEmCampoData,
  inferNotesEmCampoService,
  pickNotesEmCampoSuggestionTarget,
  rankNotesEmCampoInternals,
} from '@/lib/notes/em-campo'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotesEmCampoExternalSuggestion } from '@/lib/types/database'

const collaborators: CollaboratorData[] = [
  {
    id: 'geral-1',
    nome: 'Mayky Castro',
    ativo: true,
    max_notas: 50,
    avatar_url: null,
    especialidade: 'geral',
    recebe_distribuicao: true,
    em_ferias: false,
    qtd_nova: 0,
    qtd_em_andamento: 0,
    qtd_encaminhada: 0,
    qtd_novo: 0,
    qtd_1_dia: 0,
    qtd_2_mais: 0,
    qtd_abertas: 9,
    qtd_concluidas: 0,
    qtd_acompanhamento_ordens: 1,
  },
  {
    id: 'refrig-1',
    nome: 'Suelem Silva',
    ativo: true,
    max_notas: 50,
    avatar_url: null,
    especialidade: 'refrigeracao',
    recebe_distribuicao: true,
    em_ferias: false,
    qtd_nova: 0,
    qtd_em_andamento: 0,
    qtd_encaminhada: 0,
    qtd_novo: 0,
    qtd_1_dia: 0,
    qtd_2_mais: 0,
    qtd_abertas: 4,
    qtd_concluidas: 0,
    qtd_acompanhamento_ordens: 3,
  },
  {
    id: 'elev-1',
    nome: 'Paula Matos',
    ativo: true,
    max_notas: 50,
    avatar_url: null,
    especialidade: 'elevadores',
    recebe_distribuicao: true,
    em_ferias: false,
    qtd_nova: 0,
    qtd_em_andamento: 0,
    qtd_encaminhada: 0,
    qtd_novo: 0,
    qtd_1_dia: 0,
    qtd_2_mais: 0,
    qtd_abertas: 6,
    qtd_concluidas: 0,
    qtd_acompanhamento_ordens: 2,
  },
]

describe('buildNotesEmCampoData', () => {
  it('prioriza internos gerais para instalacao eletrica', () => {
    const data = buildNotesEmCampoData({
      collaborators,
      service: 'INSTALACAO ELETRICA',
      externals: [],
    })

    expect(data.hint.prioridade).toBe('interno')
    expect(data.hint.mensagem).toContain('Instalacao Eletrica')
    expect(data.internos[0]).toMatchObject({
      admin_id: 'geral-1',
      especialidade: 'geral',
    })
  })

  it('prioriza refrigeracao para servicos da especialidade', () => {
    const ranked = rankNotesEmCampoInternals(collaborators, 'AR CONDICIONADO SPLIT')
    expect(ranked[0]).toMatchObject({
      admin_id: 'refrig-1',
      especialidade: 'refrigeracao',
    })
  })

  it('mantem elevadores em modo equilibrado e preserva externos', () => {
    const externals: NotesEmCampoExternalSuggestion[] = [
      {
        fornecedor_codigo: '123',
        fornecedor_nome: 'Claudio Andrade Junior',
        total_em_campo: 1,
        historico_loja_servico: 2,
        historico_servico_geral: 5,
        match_mode: 'exato',
      },
    ]

    const data = buildNotesEmCampoData({
      collaborators,
      service: 'GERADOR',
      externals,
    })

    expect(data.hint.prioridade).toBe('equilibrado')
    expect(data.internos[0]).toMatchObject({
      admin_id: 'elev-1',
      especialidade: 'elevadores',
    })
    expect(data.externos).toEqual(externals)
  })

  it('infer the closest service from note description', () => {
    expect(inferNotesEmCampoService(
      'AR CONDICIONADO (ATE 60.000 BTUS)',
      ['INSTALACAO ELETRICA', 'AR CONDICIONADO', 'CONTROLE DE PRAGA'],
    )).toBe('AR CONDICIONADO')
  })

  it('uses the operational history as the primary target when there is an external fit', () => {
    const target = pickNotesEmCampoSuggestionTarget({
      collaborators,
      service: 'INSTALACAO ELETRICA',
      externals: [
        {
          fornecedor_codigo: '9002',
          fornecedor_nome: 'Claudio Andrade Junior',
          total_em_campo: 1,
          historico_loja_servico: 2,
          historico_servico_geral: 5,
          match_mode: 'exato',
        },
      ],
    })

    expect(target).toMatchObject({
      tipo: 'externo',
      nome: 'Claudio Andrade Junior',
    })
  })

  it('uses external as primary target when there is historical fit for non-electrical services', () => {
    const target = pickNotesEmCampoSuggestionTarget({
      collaborators,
      service: 'AR CONDICIONADO',
      externals: [
        {
          fornecedor_codigo: '9003',
          fornecedor_nome: 'HVAC',
          total_em_campo: 1,
          historico_loja_servico: 3,
          historico_servico_geral: 6,
          match_mode: 'exato',
        },
      ],
    })

    expect(target).toMatchObject({
      tipo: 'externo',
      nome: 'HVAC',
    })
  })
})
