import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CockpitKpiStrip } from './cockpit-kpi-strip'

const items = [
  { id: 'total', label: 'Total', value: '10' },
  { id: 'open', label: 'Abertas', value: '4' },
]

describe('CockpitKpiStrip', () => {
  it('uses two columns on mobile by default', () => {
    const { container } = render(<CockpitKpiStrip items={items} />)
    const grid = container.querySelector('.grid')

    expect(grid).toHaveClass('grid-cols-2', 'xl:grid-cols-4')
  })

  it('preserves explicit column overrides', () => {
    const { container } = render(
      <CockpitKpiStrip items={items} columnsClassName="grid-cols-1 lg:grid-cols-2" />,
    )
    const grid = container.querySelector('.grid')

    expect(grid).toHaveClass('grid-cols-1', 'lg:grid-cols-2')
    expect(grid).not.toHaveClass('grid-cols-2')
  })
})
