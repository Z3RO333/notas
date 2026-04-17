import { render, screen } from '@testing-library/react'
import { KpiStrip } from './kpi-strip'
import type { KpisNotasOrdens } from '@/lib/types/indicadores'

const mockKpis: KpisNotasOrdens = {
  total_notas: 247,
  notas_convertidas: 189,
  taxa_conversao: 76.5,
  tempo_medio_nota_ordem: 2.1,
  tempo_medio_conclusao: 4.3,
  total_ordens_concluidas: 161,
}

describe('KpiStrip', () => {
  it('renders all 6 KPI cards with correct values', () => {
    render(<KpiStrip kpis={mockKpis} />)
    expect(screen.getByText('247')).toBeInTheDocument()
    expect(screen.getByText('189')).toBeInTheDocument()
    expect(screen.getByText('76,5%')).toBeInTheDocument()
    expect(screen.getByText('2,1d')).toBeInTheDocument()
    expect(screen.getByText('4,3d')).toBeInTheDocument()
    expect(screen.getByText('161')).toBeInTheDocument()
  })

  it('shows em dash for null tempo values', () => {
    render(<KpiStrip kpis={{ ...mockKpis, tempo_medio_nota_ordem: null, tempo_medio_conclusao: null }} />)
    const placeholders = screen.getAllByText((_, element) => {
      const text = element?.textContent ?? ''
      return text === '—' || text === 'â€”'
    })
    expect(placeholders).toHaveLength(2)
  })
})
