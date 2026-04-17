import { render, screen } from '@testing-library/react'
import { LojaOrdensIndicadoresTable } from './loja-ordens-indicadores-table'
import type { LojaOrdensIndicadoresRow } from '@/lib/types/indicadores'

const rows: LojaOrdensIndicadoresRow[] = [
  { unidade: 'Loja Matriz', ordens_concluidas: 18, tempo_medio_conclusao: 3.2 },
  { unidade: 'CD Manaus', ordens_concluidas: 11, tempo_medio_conclusao: 1.8 },
]

describe('LojaOrdensIndicadoresTable', () => {
  it('renders all order rows', () => {
    render(<LojaOrdensIndicadoresTable rows={rows} />)
    expect(screen.getByText('Loja Matriz')).toBeInTheDocument()
    expect(screen.getByText('CD Manaus')).toBeInTheDocument()
  })

  it('shows empty state when rows is empty', () => {
    render(<LojaOrdensIndicadoresTable rows={[]} />)
    expect(screen.getByText(/nenhuma ordem concluida/i)).toBeInTheDocument()
  })

  it('formats completion time in days', () => {
    render(<LojaOrdensIndicadoresTable rows={rows} />)
    expect(screen.getByText('3,2d')).toBeInTheDocument()
  })
})
