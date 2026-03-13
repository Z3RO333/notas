import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComparisonKpiStrip } from './comparison-kpi-strip'

describe('ComparisonKpiStrip', () => {
  it('shows delta in plain language against the base year', () => {
    render(
      <ComparisonKpiStrip
        items={[
          {
            id: 'up',
            label: 'Total gasto',
            anoBase: 2025,
            anoComparado: 2026,
            valorBase: 100,
            valorComparado: 200,
            deltaAbs: 100,
            deltaPct: 100,
          },
          {
            id: 'down',
            label: 'Realizado',
            anoBase: 2025,
            anoComparado: 2026,
            valorBase: 200,
            valorComparado: 50,
            deltaAbs: -150,
            deltaPct: -75,
          },
          {
            id: 'flat',
            label: 'Pendente',
            anoBase: 2025,
            anoComparado: 2026,
            valorBase: 80,
            valorComparado: 80,
            deltaAbs: 0,
            deltaPct: 0,
          },
        ]}
        formatValue={(value) => `R$ ${value}`}
      />,
    )

    expect(screen.getByText('A mais vs 2025')).toBeInTheDocument()
    expect(screen.getByText('A menos vs 2025')).toBeInTheDocument()
    expect(screen.getByText('Mesmo nivel de 2025')).toBeInTheDocument()
    expect(screen.getByText('R$ 150')).toBeInTheDocument()
    expect(screen.queryByText('R$ -150')).not.toBeInTheDocument()
  })
})
