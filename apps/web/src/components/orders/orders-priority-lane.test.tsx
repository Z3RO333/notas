import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlertTriangle } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { OrdersPriorityLane } from '@/components/orders/orders-priority-lane'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

vi.mock('@/components/orders/order-compact-card', () => ({
  OrderCompactCard: ({ row }: { row: OrdemNotaAcompanhamento }) => <div>{row.ordem_codigo}</div>,
}))

function makeRow(overrides: Partial<OrdemNotaAcompanhamento> = {}): OrdemNotaAcompanhamento {
  return {
    ordem_id: overrides.ordem_id ?? '11111111-1111-4111-8111-111111111111',
    nota_id: overrides.nota_id ?? '22222222-2222-4222-8222-222222222222',
    numero_nota: overrides.numero_nota ?? '10171264',
    ordem_codigo: overrides.ordem_codigo ?? '5225129',
    administrador_id: overrides.administrador_id ?? null,
    administrador_nome: overrides.administrador_nome ?? null,
    responsavel_atual_id: overrides.responsavel_atual_id ?? 'admin-1',
    responsavel_atual_nome: overrides.responsavel_atual_nome ?? 'Wanderlucio Mendes',
    centro: overrides.centro ?? '103',
    unidade: overrides.unidade ?? 'RORAINOPOLIS',
    status_ordem: overrides.status_ordem ?? 'aberta',
    status_ordem_raw: overrides.status_ordem_raw ?? 'ABERTO',
    ordem_detectada_em: overrides.ordem_detectada_em ?? '2026-04-05T12:00:00.000Z',
    status_atualizado_em: overrides.status_atualizado_em ?? '2026-04-05T12:00:00.000Z',
    dias_para_gerar_ordem: overrides.dias_para_gerar_ordem ?? 2,
    qtd_historico: overrides.qtd_historico ?? 0,
    tem_historico: overrides.tem_historico ?? false,
    dias_em_aberto: overrides.dias_em_aberto ?? 2,
    semaforo_atraso: overrides.semaforo_atraso ?? 'verde',
    envolvidos_admin_ids: overrides.envolvidos_admin_ids ?? [],
    descricao: overrides.descricao ?? 'Metalurgica',
    tipo_ordem: overrides.tipo_ordem ?? 'PMOS',
  }
}

function renderLane({
  loading = false,
  refreshing = false,
}: {
  loading?: boolean
  refreshing?: boolean
} = {}) {
  return render(
    <OrdersPriorityLane
      title="Ordens mais antigas"
      description="Carteira critica"
      emptyMessage="Nenhuma ordem atrasada encontrada neste escopo."
      actionLabel="Filtrar atrasadas"
      total={3}
      rows={[makeRow()]}
      loading={loading}
      refreshing={refreshing}
      icon={AlertTriangle}
      tone="danger"
      canReassign={false}
      reassignTargets={[]}
      onAction={vi.fn()}
      onOpenDetails={vi.fn()}
      onReassigned={vi.fn()}
    />,
  )
}

describe('OrdersPriorityLane', () => {
  it('shows a loading hint instead of an empty state while highlights are loading', () => {
    renderLane({ loading: true })

    expect(screen.getByText('Carregando destaques deste bloco...')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma ordem atrasada encontrada neste escopo.')).not.toBeInTheDocument()
  })

  it('renders skeleton cards when expanded during loading', async () => {
    const user = userEvent.setup()

    renderLane({ loading: true })

    await user.click(screen.getByRole('button', { name: 'Expandir' }))

    expect(screen.getByText('Carregando ordens em destaque...')).toBeInTheDocument()
    expect(screen.getByLabelText('Carregando ordens em ordens mais antigas')).toBeInTheDocument()
  })

  it('shows a refresh indicator while keeping loaded content visible', async () => {
    const user = userEvent.setup()

    renderLane({ refreshing: true })

    expect(screen.getByText('Atualizando destaques...')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expandir' }))

    expect(screen.getByText('5225129')).toBeInTheDocument()
  })
})
