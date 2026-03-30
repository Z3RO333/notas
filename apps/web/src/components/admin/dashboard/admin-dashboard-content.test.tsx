import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminDashboardContent } from './admin-dashboard-content'

vi.mock('@/components/shared/page-title-block', () => ({
  PageTitleBlock: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock('./admin-orders-section-skeleton', () => ({
  AdminOrdersSectionSkeleton: () => <div data-testid="orders-skeleton" />,
}))

vi.mock('./admin-productivity-panel', () => ({
  AdminProductivityPanel: () => <div data-testid="productivity-panel" />,
}))

vi.mock('./admin-productivity-filter', () => ({
  AdminProductivityFilter: () => <div data-testid="productivity-filter">filtro</div>,
}))

describe('AdminDashboardContent', () => {
  it('wraps the productivity filter in a sticky bar below the admin navigation', () => {
    render(
      <AdminDashboardContent
        period={{
          year: 2026,
          month: 3,
          label: 'Mar/2026',
          startIso: '2026-03-01T00:00:00.000Z',
          endExclusiveIso: '2026-04-01T00:00:00.000Z',
          previous: {
            label: 'Fev/2026',
            startIso: '2026-02-01T00:00:00.000Z',
            endExclusiveIso: '2026-03-01T00:00:00.000Z',
          },
          rollingMonths: [],
        }}
        yearOptions={[2026, 2025, 2024]}
        especialidade="eletricista"
      />,
    )

    const stickyWrapper = screen.getByTestId('productivity-filter').parentElement

    expect(screen.getByText('Produtividade Mensal')).toBeInTheDocument()
    expect(stickyWrapper).toHaveClass('sticky', 'top-14', 'z-20')
    expect(stickyWrapper).toHaveClass('backdrop-blur')
    expect(screen.getByTestId('productivity-panel')).toBeInTheDocument()
  })
})
