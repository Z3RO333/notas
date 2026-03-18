import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesEmCampoDialog } from '@/components/notas/notes-em-campo-dialog'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
  }),
}))

const collaborators: CollaboratorData[] = [
  {
    id: 'admin-1',
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
    qtd_abertas: 7,
    qtd_concluidas: 0,
    qtd_acompanhamento_ordens: 1,
  },
  {
    id: 'admin-2',
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
    qtd_acompanhamento_ordens: 2,
  },
]

const notes: NotaPanelData[] = [
  {
    id: 'nota-1',
    numero_nota: '10170655',
    descricao: 'INSTALACAO ELETRICA NO QUADRO PRINCIPAL',
    status: 'nova',
    administrador_id: 'admin-1',
    prioridade: null,
    centro: '101',
    denominacao_unidade: 'Loja Matriz',
    data_criacao_sap: '2026-03-18',
    created_at: '2026-03-18T10:00:00.000Z',
  },
]

describe('NotesEmCampoDialog', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'buscar_operacionais_em_campo') {
        return {
          data: [
            {
              fornecedor_codigo: '9001',
              fornecedor_nome: 'Operacional Externo A',
              total_em_campo: 2,
            },
          ],
          error: null,
        }
      }

      if (fn === 'listar_servicos_historicos_notas_em_campo') {
        return {
          data: [
            {
              texto_breve: 'INSTALACAO ELETRICA',
              total_ordens: 12,
            },
          ],
          error: null,
        }
      }

      if (fn === 'buscar_sugestoes_operacionais_externos_notas_em_campo') {
        return {
          data: [
            {
              fornecedor_codigo: '9002',
              fornecedor_nome: 'Claudio Andrade Junior',
              total_em_campo: 1,
              historico_loja_servico: 2,
              historico_servico_geral: 5,
              match_mode: 'exato',
            },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
    })
  })

  it('renders the trigger and shows current guidance when opened without correlacao', async () => {
    const user = userEvent.setup()

    render(
      <NotesEmCampoDialog
        collaborators={collaborators}
        notes={notes}
        unidadeOptions={[{ value: '101', label: 'Loja Matriz' }]}
      />
    )

    expect(screen.getByRole('button', { name: /Em Campo/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Em Campo/i }))

    const hints = await screen.findAllByText(/Selecione loja e servico para habilitar a correlacao/i)
    expect(hints.length).toBeGreaterThan(0)
    expect(await screen.findByText('Operacional Externo A')).toBeInTheDocument()
  })

  it('loads external suggestions after selecting loja and servico', async () => {
    const user = userEvent.setup()

    render(
      <NotesEmCampoDialog
        collaborators={collaborators}
        notes={notes}
        unidadeOptions={[{ value: '101', label: 'Loja Matriz' }]}
      />
    )

    await user.click(screen.getByRole('button', { name: /Em Campo/i }))

    const lojaTrigger = screen.getByText('Escolha a loja').closest('button')
    expect(lojaTrigger).not.toBeNull()
    await user.click(lojaTrigger!)
    await user.click(await screen.findByRole('button', { name: 'Loja Matriz' }))

    const servicoTrigger = screen.getByText('Escolha o servico').closest('button')
    expect(servicoTrigger).not.toBeNull()
    await user.click(servicoTrigger!)
    await user.click(await screen.findByRole('button', { name: 'INSTALACAO ELETRICA' }))

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('buscar_sugestoes_operacionais_externos_notas_em_campo', {
        p_nome_loja: 'Loja Matriz',
        p_texto_breve: 'INSTALACAO ELETRICA',
      })
    })

    expect((await screen.findAllByText('Claudio Andrade Junior')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 loja + servico').length).toBeGreaterThan(0)
    expect(screen.getByText(/Prioridade: interno/i)).toBeInTheDocument()
    expect(screen.getByText('10170655')).toBeInTheDocument()
    expect(screen.getAllByText('Claudio Andrade Junior').length).toBeGreaterThan(0)
  })
})
