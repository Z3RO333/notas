import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesEmCampoDialog } from '@/components/notas/notes-em-campo-dialog'
import type { NotaPanelData } from '@/lib/types/database'

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: rpcMock,
  }),
}))

const notes: NotaPanelData[] = [
  {
    id: 'nota-1',
    numero_nota: '10170655',
    descricao: 'INSTALACAO ELETRICA NO QUADRO PRINCIPAL',
    status: 'nova',
    administrador_id: 'admin-1',
    prioridade: null,
    centro: '520',
    denominacao_unidade: 'Loja Manacapuru',
    data_criacao_sap: '2026-03-18',
    created_at: '2026-03-18T10:00:00.000Z',
  },
]

describe('NotesEmCampoDialog', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    rpcMock.mockImplementation(async (fn: string, params?: Record<string, unknown>) => {
      if (fn === 'listar_operacionais_carga_notas_em_campo') {
        return {
          data: [
            {
              fornecedor_codigo: '22578',
              fornecedor_nome: 'CLAUDIOMAR LOPES DA SILVA',
              total_em_campo: 2,
              ordens_mesma_loja_ativas: params?.p_nome_loja === 'Loja Manacapuru' ? 1 : 0,
            },
            {
              fornecedor_codigo: '22016',
              fornecedor_nome: 'EDESON MONTEIRO SOUSA',
              total_em_campo: 1,
              ordens_mesma_loja_ativas: 0,
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

      if (fn === 'buscar_sugestoes_operacionais_notas_em_campo') {
        return {
          data: [
            {
              fornecedor_codigo: '22578',
              fornecedor_nome: 'CLAUDIOMAR LOPES DA SILVA',
              total_em_campo: 2,
              ordens_mesma_loja_ativas: 1,
              historico_loja_servico: 4,
              historico_servico_geral: 10,
              match_mode: 'exato',
            },
            {
              fornecedor_codigo: '22016',
              fornecedor_nome: 'EDESON MONTEIRO SOUSA',
              total_em_campo: 1,
              ordens_mesma_loja_ativas: 0,
              historico_loja_servico: 2,
              historico_servico_geral: 6,
              match_mode: 'fallback_servico',
            },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
    })
  })

  it('renders the trigger and shows current operational load when opened without correlacao', async () => {
    const user = userEvent.setup()

    render(
      <NotesEmCampoDialog
        notes={notes}
        unidadeOptions={[{ value: '520', label: 'Loja Manacapuru' }]}
      />
    )

    expect(screen.getByRole('button', { name: /Em Campo/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Em Campo/i }))

    const hints = await screen.findAllByText(/Selecione loja e servico para habilitar a correlacao/i)
    expect(hints.length).toBeGreaterThan(0)
    expect(screen.getByText('Sugestoes por nota')).toBeInTheDocument()
    expect((await screen.findAllByText('CLAUDIOMAR LOPES DA SILVA')).length).toBeGreaterThan(0)
  })

  it('loads operational suggestions and keeps only the best option visible until details are expanded', async () => {
    const user = userEvent.setup()

    render(
      <NotesEmCampoDialog
        notes={notes}
        unidadeOptions={[{ value: '520', label: 'Loja Manacapuru' }]}
      />
    )

    await user.click(screen.getByRole('button', { name: /Em Campo/i }))

    const lojaTrigger = screen.getByText('Escolha a loja').closest('button')
    expect(lojaTrigger).not.toBeNull()
    await user.click(lojaTrigger!)
    await user.click(await screen.findByRole('button', { name: 'Loja Manacapuru' }))

    const servicoTrigger = screen.getByText('Escolha o servico').closest('button')
    expect(servicoTrigger).not.toBeNull()
    await user.click(servicoTrigger!)
    await user.click(await screen.findByRole('button', { name: 'INSTALACAO ELETRICA' }))

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('buscar_sugestoes_operacionais_notas_em_campo', {
        p_nome_loja: 'Loja Manacapuru',
        p_texto_breve: 'INSTALACAO ELETRICA',
      })
    })

    expect(screen.getAllByText('CLAUDIOMAR LOPES DA SILVA').length).toBeGreaterThan(0)
    expect(screen.getByText('10170655')).toBeInTheDocument()
    expect(screen.getByText(/Vale consolidar esta nota com ele/i)).toBeInTheDocument()
    expect(screen.getByText('1 ativa(s)')).toBeInTheDocument()
    expect(screen.queryByText('Mayky Castro')).not.toBeInTheDocument()

    const noteCard = screen.getByTestId('notes-em-campo-suggestion-10170655')
    expect(noteCard).not.toHaveTextContent('Outras opcoes para esta nota')

    await user.click(screen.getByRole('button', { name: /Ver detalhes/i }))

    expect(noteCard).toHaveTextContent('Outras opcoes para esta nota')
    expect(noteCard).toHaveTextContent('EDESON MONTEIRO SOUSA')
  })
})
