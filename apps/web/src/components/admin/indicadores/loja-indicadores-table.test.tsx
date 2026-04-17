import { render, screen } from '@testing-library/react'
import { LojaIndicadoresTable } from './loja-indicadores-table'
import type { LojaIndicadoresRow } from '@/lib/types/indicadores'

const rows: LojaIndicadoresRow[] = [
  { unidade: 'Camapuã', total_notas: 45, total_ordens: 40, taxa_conversao: 88.9 },
  { unidade: 'Coari', total_notas: 22, total_ordens: 14, taxa_conversao: 63.6 },
]

describe('LojaIndicadoresTable', () => {
  it('renders all rows', () => {
    render(<LojaIndicadoresTable rows={rows} />)
    expect(screen.getByText('Camapuã')).toBeInTheDocument()
    expect(screen.getByText('Coari')).toBeInTheDocument()
  })

  it('shows empty state when rows is empty', () => {
    render(<LojaIndicadoresTable rows={[]} />)
    expect(screen.getByText(/nenhuma unidade/i)).toBeInTheDocument()
  })

  it('shows high conversion badge correctly', () => {
    render(<LojaIndicadoresTable rows={rows} />)
    expect(screen.getByText('88,9%')).toBeInTheDocument()
  })
})
