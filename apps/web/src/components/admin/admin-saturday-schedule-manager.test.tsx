import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSaturdayScheduleSlots, type SaturdayScheduleCandidate } from '@/lib/admin/saturday-distribution-schedule'
import { AdminSaturdayScheduleManager } from './admin-saturday-schedule-manager'

const replaceMock = vi.fn()
const refreshMock = vi.fn()
const toastMock = vi.fn()
const salvarEscalaDistribuicaoSabadoMock = vi.fn()
let searchParamsValue = 'escalaMes=2026-05'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  usePathname: () => '/admin/administracao',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/lib/actions/admin-actions', () => ({
  salvarEscalaDistribuicaoSabado: (...args: unknown[]) => salvarEscalaDistribuicaoSabadoMock(...args),
}))

const candidates: SaturdayScheduleCandidate[] = [
  {
    id: 'admin-1',
    nome: 'Fabiola Tentuge',
    email: 'fabiola@bemol.com.br',
    ativo: true,
    em_ferias: false,
  },
  {
    id: 'admin-2',
    nome: 'Mayky Castro',
    email: 'mayky@bemol.com.br',
    ativo: true,
    em_ferias: false,
  },
]

describe('AdminSaturdayScheduleManager', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    refreshMock.mockReset()
    toastMock.mockReset()
    salvarEscalaDistribuicaoSabadoMock.mockReset()
    searchParamsValue = 'escalaMes=2026-05'
  })

  it('updates the selected month in the query string', async () => {
    render(
      <AdminSaturdayScheduleManager
        selectedMonthKey="2026-05"
        candidates={candidates}
        slots={buildSaturdayScheduleSlots('2026-05', [])}
      />,
    )

    fireEvent.change(screen.getByLabelText('Mes da escala'), {
      target: { value: '2026-06' },
    })

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin/administracao?escalaMes=2026-06')
    })
  })

  it('blocks save when a saturday has participants but no end time', async () => {
    const user = userEvent.setup()

    render(
      <AdminSaturdayScheduleManager
        selectedMonthKey="2026-05"
        candidates={candidates}
        slots={buildSaturdayScheduleSlots('2026-05', [])}
      />,
    )

    const firstSaturdayCard = screen.getByText('1o sabado - 02/05').closest('div.rounded-lg')
    expect(firstSaturdayCard).not.toBeNull()

    await user.click(within(firstSaturdayCard as HTMLElement).getByRole('checkbox', { name: /Fabiola Tentuge/i }))
    await user.click(screen.getByRole('button', { name: 'Salvar escala do mes' }))

    expect(salvarEscalaDistribuicaoSabadoMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Escala de sabado incompleta',
      variant: 'error',
    }))
  })
})
