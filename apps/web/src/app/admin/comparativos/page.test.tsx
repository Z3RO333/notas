import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ComparativosPage from './page'

const rpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc: rpcMock,
  })),
}))

vi.mock('./components/orders-comparison-chart', () => ({
  OrdersComparisonChart: () => <div data-testid="orders-chart" />,
}))

vi.mock('./components/finance-comparison-chart', () => ({
  FinanceComparisonChart: () => <div data-testid="finance-chart" />,
}))

vi.mock('./components/suppliers-comparison-section', () => ({
  SuppliersComparisonSection: () => <div data-testid="suppliers-section" />,
}))

vi.mock('./components/comparativos-filters', () => ({
  ComparativosFilters: ({ anoBase, anoComparado, tipoOrdem }: { anoBase: number; anoComparado: number; tipoOrdem: string }) => (
    <div data-testid="comparativos-filters">
      filtros-{anoBase}-{anoComparado}-{tipoOrdem}
    </div>
  ),
}))

describe('ComparativosPage', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    rpcMock.mockImplementation(async (name: string, params?: Record<string, unknown>) => {
      if (name === 'listar_comparativo_anos') {
        return { data: [{ ano: 2026 }, { ano: 2025 }, { ano: 2024 }], error: null }
      }
      if (name === 'calcular_comparativo_ordens_mensal') {
        expect(params).toMatchObject({ p_ano_base: 2024, p_ano_comparado: 2026, p_tipo_ordem: 'PMPL' })
        return { data: [], error: null }
      }
      if (name === 'calcular_comparativo_ordens_anual') {
        return { data: [], error: null }
      }
      if (name === 'calcular_comparativo_financeiro_mensal') {
        return { data: [], error: null }
      }
      if (name === 'calcular_comparativo_financeiro_anual') {
        return { data: [], error: null }
      }
      if (name === 'calcular_comparativo_financeiro_fornecedores_anual') {
        return {
          data: [
            {
              fornecedor_ref: '200',
              fornecedor_codigo: '200',
              fornecedor_nome: 'Fornecedor B',
              ano: 2026,
              total_ordens: 1,
              total_gasto: 100,
              valor_realizado: 100,
              valor_previsto_pendente: 0,
            },
          ],
          error: null,
        }
      }
      if (name === 'calcular_comparativo_financeiro_fornecedor_mensal') {
        expect(params).toMatchObject({
          p_ano_base: 2024,
          p_ano_comparado: 2026,
          p_tipo_ordem: 'PMPL',
          p_fornecedor_codigo: '200',
        })
        return { data: [], error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    })
  })

  it('renders the page and propagates query params to the comparison RPCs', async () => {
    render(await ComparativosPage({
      searchParams: Promise.resolve({
        ano_base: '2024',
        ano_comparado: '2026',
        tipo_ordem: 'PMPL',
        fornecedor: '200',
      }),
    }))

    expect(screen.getByText('Comparativos anuais')).toBeInTheDocument()
    expect(screen.getByTestId('comparativos-filters')).toHaveTextContent('filtros-2024-2026-PMPL')
    expect(screen.getByTestId('orders-chart')).toBeInTheDocument()
    expect(screen.getByTestId('finance-chart')).toBeInTheDocument()
    expect(screen.getByTestId('suppliers-section')).toBeInTheDocument()
  })
})
