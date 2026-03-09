import { describe, expect, it } from 'vitest'
import { withCollaboratorDisplayMetrics } from '@/lib/collaborator/display-metrics'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

function toIsoAtLocalNoon(base: Date, dayOffset: number): string {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 12, 0, 0, 0)
  return date.toISOString()
}

describe('withCollaboratorDisplayMetrics', () => {
  it('recomputes the open-note counters from the provided notes', () => {
    const now = new Date()
    const collaborator: CollaboratorData = {
      id: 'admin-1',
      nome: 'Admin 1',
      ativo: true,
      max_notas: 50,
      avatar_url: null,
      especialidade: 'geral',
      recebe_distribuicao: true,
      em_ferias: false,
      qtd_nova: 99,
      qtd_em_andamento: 99,
      qtd_encaminhada: 99,
      qtd_novo: 99,
      qtd_1_dia: 99,
      qtd_2_mais: 99,
      qtd_abertas: 99,
      qtd_concluidas: 3,
      qtd_acompanhamento_ordens: 2,
    }
    const notas: NotaPanelData[] = [
      {
        id: 'n-1',
        numero_nota: '1001',
        descricao: 'Hoje',
        status: 'nova',
        administrador_id: 'admin-1',
        prioridade: null,
        centro: null,
        data_criacao_sap: null,
        created_at: toIsoAtLocalNoon(now, 0),
      },
      {
        id: 'n-2',
        numero_nota: '1002',
        descricao: 'Ontem',
        status: 'em_andamento',
        administrador_id: 'admin-1',
        prioridade: null,
        centro: null,
        data_criacao_sap: null,
        created_at: toIsoAtLocalNoon(now, -1),
      },
      {
        id: 'n-3',
        numero_nota: '1003',
        descricao: 'Antiga',
        status: 'encaminhada_fornecedor',
        administrador_id: 'admin-1',
        prioridade: null,
        centro: null,
        data_criacao_sap: null,
        created_at: toIsoAtLocalNoon(now, -3),
      },
      {
        id: 'n-4',
        numero_nota: '1004',
        descricao: 'Concluida',
        status: 'concluida',
        administrador_id: 'admin-1',
        prioridade: null,
        centro: null,
        data_criacao_sap: null,
        created_at: toIsoAtLocalNoon(now, 0),
      },
    ]

    expect(withCollaboratorDisplayMetrics(collaborator, notas)).toMatchObject({
      qtd_nova: 1,
      qtd_em_andamento: 1,
      qtd_encaminhada: 1,
      qtd_novo: 1,
      qtd_1_dia: 1,
      qtd_2_mais: 1,
      qtd_abertas: 3,
      qtd_concluidas: 3,
      qtd_acompanhamento_ordens: 2,
    })
  })
})
