import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PedidoRow } from './pedido-row'
import { PedidosKpiStrip } from './pedidos-kpi-strip'
import type { PedidoCompra } from '@/lib/types/pedidos'

const pedido: PedidoCompra = {
  id: 'pedido-1',
  documento_compras: '4500000123',
  administrador_id: 'admin-1',
  sap_codigo: 'SAP01',
  fornecedor: '12029',
  fornecedor_codigo: '12029',
  fornecedor_nome: 'Fornecedor Manaus',
  data_documento: '2026-08-10',
  valor_liquido_total: 1500,
  valor_itens_ativos: 1200,
  itens_total: 3,
  itens_ativos: 2,
  status: 'em_aberto',
  status_efetivo: 'indeterminado',
  tipo_documento: 'ZNB',
  grupo_compradores: '112',
  mes_extracao: '202608',
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-14T00:00:00Z',
  nf_referencias: [],
  responsavel_atual_id: 'admin-1',
  responsavel_atual_nome: 'Paula Matos',
  fornecedor_owner_nome: 'Fabíola Tentunge',
  na_carteira_especial: true,
}

describe('Pedidos workspace UI', () => {
  it('aplica filtro de status ao clicar em um KPI acionável', () => {
    const onStatusChange = vi.fn()
    render(
      <PedidosKpiStrip
        kpis={{
          total: 10,
          em_aberto: 4,
          encerrado: 5,
          cancelado: 0,
          valor_total: 5000,
          valor_em_aberto: 2000,
          abertos_mais_90_dias: 1,
          sem_responsavel: 1,
          status_indeterminado: 1,
        }}
        activeStatus="all"
        onStatusChange={onStatusChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Em aberto/i }))
    expect(onStatusChange).toHaveBeenCalledWith('em_aberto')
    expect(screen.getByText(/R\$\s*2\s*mil/i)).toBeInTheDocument()
  })

  it('mostra status efetivo, responsabilidades e valor operacional na linha', () => {
    const onOpen = vi.fn()
    render(<PedidoRow pedido={pedido} onOpen={onOpen} />)

    expect(screen.getByText('A revisar')).toBeInTheDocument()
    expect(screen.getByText('Dono da carteira: Fabíola Tentunge')).toBeInTheDocument()
    expect(screen.getByText(/Responsável:/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s*1\.200,00/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith(pedido)
  })
})
