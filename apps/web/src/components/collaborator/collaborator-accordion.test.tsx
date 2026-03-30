import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CollaboratorAccordion } from './collaborator-accordion'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { NotaPanelData } from '@/lib/types/database'

vi.mock('@/components/painel/nota-list-item', () => ({
  NotaListItem: ({ allowOperationalActions }: { allowOperationalActions?: boolean }) => (
    <div>list:{allowOperationalActions === false ? 'off' : 'on'}</div>
  ),
}))

vi.mock('@/components/painel/nota-card', () => ({
  NotaCard: ({ allowOperationalActions }: { allowOperationalActions?: boolean }) => (
    <div>card:{allowOperationalActions === false ? 'off' : 'on'}</div>
  ),
}))

vi.mock('@/components/painel/admin-summary', () => ({
  AdminSummary: () => <div>summary</div>,
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const collaborator = {
  id: 'admin-1',
  nome: 'Colaborador Teste',
  ativo: true,
  max_notas: 10,
  avatar_url: null,
  especialidade: 'geral',
  recebe_distribuicao: true,
  em_ferias: false,
  qtd_nova: 1,
  qtd_em_andamento: 0,
  qtd_encaminhada: 0,
  qtd_novo: 1,
  qtd_1_dia: 0,
  qtd_2_mais: 0,
  qtd_abertas: 1,
  qtd_concluidas: 0,
  qtd_acompanhamento_ordens: 0,
} satisfies CollaboratorData

const notas = [
  {
    id: 'nota-1',
    numero_nota: '10000001',
    descricao: 'Troca de lampada',
    status: 'nova',
    created_at: '2026-03-30T12:00:00.000Z',
  },
] as NotaPanelData[]

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('CollaboratorAccordion', () => {
  it('hides bulk and item actions in list mode for viewer read-only', () => {
    render(
      <CollaboratorAccordion
        collaborator={collaborator}
        notas={notas}
        isOpen
        viewMode="list"
        allowOperationalActions={false}
      />,
    )

    expect(screen.queryByText('Copiar tudo')).not.toBeInTheDocument()
    expect(screen.getByText('list:off')).toBeInTheDocument()
  })

  it('passes read-only mode to card items too', () => {
    render(
      <CollaboratorAccordion
        collaborator={collaborator}
        notas={notas}
        isOpen
        viewMode="cards"
        allowOperationalActions={false}
      />,
    )

    expect(screen.getByText('card:off')).toBeInTheDocument()
  })
})
