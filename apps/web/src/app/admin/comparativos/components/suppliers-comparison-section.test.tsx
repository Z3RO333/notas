import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SuppliersComparisonSection } from './suppliers-comparison-section'
import type { SupplierAnnualComparisonRow } from '../comparativos-utils'

const replaceMock = vi.fn()
let searchParamsValue = 'ano_base=2025&ano_comparado=2026'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/admin/comparativos',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

const annualRows: SupplierAnnualComparisonRow[] = [
  {
    fornecedorRef: '100',
    fornecedorCodigo: '100',
    fornecedorNome: 'Fornecedor A',
    ordensBase: 2,
    ordensComparado: 3,
    totalBase: 100,
    totalComparado: 250,
    realizadoBase: 100,
    realizadoComparado: 250,
    pendenteBase: 0,
    pendenteComparado: 0,
    deltaAbs: 150,
    deltaPct: 150,
  },
  {
    fornecedorRef: '200',
    fornecedorCodigo: '200',
    fornecedorNome: 'Fornecedor B',
    ordensBase: 1,
    ordensComparado: 2,
    totalBase: 80,
    totalComparado: 120,
    realizadoBase: 80,
    realizadoComparado: 120,
    pendenteBase: 0,
    pendenteComparado: 0,
    deltaAbs: 40,
    deltaPct: 50,
  },
]

describe('SuppliersComparisonSection', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    searchParamsValue = 'ano_base=2025&ano_comparado=2026'
  })

  it('filters suppliers locally and pushes fornecedor selection to the URL', async () => {
    const user = userEvent.setup()

    render(
      <SuppliersComparisonSection
        annualRows={annualRows}
        monthlyRows={[]}
        selectedSupplierRef={null}
        anoBase={2025}
        anoComparado={2026}
      />,
    )

    await user.type(screen.getByPlaceholderText('Buscar fornecedor'), 'Fornecedor B')

    expect(screen.queryByText('Fornecedor A')).not.toBeInTheDocument()
    expect(screen.getByText('Fornecedor B')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Fornecedor B/i }))

    expect(replaceMock).toHaveBeenCalledWith('/admin/comparativos?ano_base=2025&ano_comparado=2026&fornecedor=200')
  })
})
