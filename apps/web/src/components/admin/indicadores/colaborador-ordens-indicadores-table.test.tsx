import { render, screen } from '@testing-library/react'
import { ColaboradorOrdensIndicadoresTable } from './colaborador-ordens-indicadores-table'
import type { ColaboradorOrdensIndicadoresRow } from '@/lib/types/indicadores'

const rows: ColaboradorOrdensIndicadoresRow[] = [
  { administrador_id: '1', nome: 'Mazurkevs Matos', ordens_concluidas: 22, tempo_medio_conclusao: 2.4 },
  { administrador_id: '2', nome: 'Fabiola Tentuge', ordens_concluidas: 18, tempo_medio_conclusao: 1.9 },
]

describe('ColaboradorOrdensIndicadoresTable', () => {
  it('renders all collaborator rows', () => {
    render(<ColaboradorOrdensIndicadoresTable rows={rows} />)
    expect(screen.getByText('Mazurkevs Matos')).toBeInTheDocument()
    expect(screen.getByText('Fabiola Tentuge')).toBeInTheDocument()
  })

  it('shows empty state when rows is empty', () => {
    render(<ColaboradorOrdensIndicadoresTable rows={[]} />)
    expect(screen.getByText(/nenhum colaborador com ordem concluida/i)).toBeInTheDocument()
  })

  it('formats completion time in days', () => {
    render(<ColaboradorOrdensIndicadoresTable rows={rows} />)
    expect(screen.getByText('2,4d')).toBeInTheDocument()
  })
})
