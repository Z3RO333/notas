import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_PRODUCTIVITY_MONTHS_PARAM } from '@/lib/dashboard/productivity-month'
import { AdminProductivityFilter } from './admin-productivity-filter'

const replaceMock = vi.fn()
let searchParamsValue = 'ano=2026&mes=3&especialidade=eletricista'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

describe('AdminProductivityFilter', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    searchParamsValue = 'ano=2026&mes=3&especialidade=eletricista'
  })

  it('renders the active summary closed by default and expands on demand', async () => {
    const user = userEvent.setup()

    render(
      <AdminProductivityFilter
        selectedYear={2026}
        selectedMonth={3}
        yearOptions={[2026, 2025, 2024]}
        selectedEspecialidade="eletricista"
      />,
    )

    const toggle = screen.getByRole('button', { name: /filtros do painel/i })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('Eletricista')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Ano' })).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: 'Ano' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Mes' })).toBeInTheDocument()
  })

  it('updates the month param while preserving the other active filters', async () => {
    const user = userEvent.setup()

    render(
      <AdminProductivityFilter
        selectedYear={2026}
        selectedMonth={3}
        yearOptions={[2026, 2025, 2024]}
        selectedEspecialidade="eletricista"
      />,
    )

    await user.click(screen.getByRole('button', { name: /filtros do painel/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mes' }), '4')

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin?ano=2026&mes=4&especialidade=eletricista')
    })
  })

  it('supports an annual total option in the month selector', async () => {
    const user = userEvent.setup()

    render(
      <AdminProductivityFilter
        selectedYear={2026}
        selectedMonth={null}
        yearOptions={[2026, 2025, 2024]}
        selectedEspecialidade="eletricista"
      />,
    )

    expect(screen.getByText('Ano 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /filtros do painel/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mes' }), ALL_PRODUCTIVITY_MONTHS_PARAM)

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin?ano=2026&mes=all&especialidade=eletricista')
    })
  })
})
