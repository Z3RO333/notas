import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FornecedoresCarteiraPanel } from './fornecedores-carteira-panel'

function renderWithQuery(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FornecedoresCarteiraPanel', () => {
  it('renders corretiva rows without SAP order badges and fetches ?tipo=corretiva', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            fornecedorCodigo: '10079',
            fornecedorNome: 'NDS',
            tipoCarteira: 'corretiva',
            adminId: 'admin-1',
            adminNome: 'Paula Matos',
            adminAvatar: null,
            qtdPedidos: 10,
            emAberto: 2,
            encerrado: 7,
            cancelado: 1,
            valorTotal: 1000,
          },
        ],
        kpis: {
          totalFornecedores: 1,
          totalPedidos: 10,
          emAberto: 2,
          encerrado: 7,
          cancelado: 1,
          valorTotal: 1000,
        },
        availableAdmins: [{ id: 'admin-1', nome: 'Paula Matos', avatar_url: null }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithQuery(<FornecedoresCarteiraPanel isGestor={false} tipoCarteira="corretiva" />)

    await waitFor(() => expect(screen.getByText('NDS')).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/pedidos/carteira-fornecedores?tipo=corretiva'),
      expect.anything()
    )

    // No SAP order-number badge (PEDIDO_ANUAL_2026_NUMEROS) should be rendered for corretiva
    expect(screen.queryByText('4508545460')).not.toBeInTheDocument()
  })

  it('renders preventiva_anual empty state and fetches ?tipo=preventiva_anual', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        kpis: { totalFornecedores: 0, totalPedidos: 0, emAberto: 0, encerrado: 0, cancelado: 0, valorTotal: 0 },
        availableAdmins: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithQuery(<FornecedoresCarteiraPanel isGestor={false} tipoCarteira="preventiva_anual" />)

    await waitFor(() =>
      expect(screen.getByText('Nenhum fornecedor mapeado na carteira de preventivas anuais.')).toBeInTheDocument()
    )

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/pedidos/carteira-fornecedores?tipo=preventiva_anual'),
      expect.anything()
    )
  })
})
