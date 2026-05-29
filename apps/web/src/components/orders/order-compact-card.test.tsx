import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OrderCompactCard } from '@/components/orders/order-compact-card'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/components/orders/order-reassign-dialog', () => ({
  OrderReassignDialog: () => <div>reassign-dialog</div>,
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

describe('OrderCompactCard', () => {
  it('toggles selection only once and does not open details when clicking the checkbox', async () => {
    const user = userEvent.setup()
    const onToggleSelection = vi.fn()
    const onOpenDetails = vi.fn()

    render(
      <OrderCompactCard
        row={makeRow()}
        selected={false}
        showCheckbox
        onToggleSelection={onToggleSelection}
        onOpenDetails={onOpenDetails}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar nota 10171264' }))

    expect(onToggleSelection).toHaveBeenCalledTimes(1)
    expect(onToggleSelection).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', false)
    expect(onOpenDetails).not.toHaveBeenCalled()
  })
})
