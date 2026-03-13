import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComparativosFilters } from './comparativos-filters'

const replaceMock = vi.fn()
let searchParamsValue = 'ano_base=2025&ano_comparado=2026&tipo_ordem=PMOS&fornecedor=100'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/admin/comparativos',
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

vi.mock('@/components/ui/select', () => {
  function collectItems(children: ReactNode): Array<{ value: string; label: string; disabled?: boolean }> {
    const items: Array<{ value: string; label: string; disabled?: boolean }> = []

    for (const child of Array.isArray(children) ? children : [children]) {
      if (!child || typeof child === 'string' || typeof child === 'number') continue
      if (!('props' in child)) continue

      const element = child as ReactElement<{ value?: string; disabled?: boolean; children?: ReactNode }>
      if (typeof element.props.value === 'string') {
        items.push({
          value: element.props.value,
          label: String(element.props.children ?? ''),
          disabled: element.props.disabled,
        })
      }

      if (element.props.children) {
        items.push(...collectItems(element.props.children))
      }
    }

    return items
  }

  function findAriaLabel(children: ReactNode): string | undefined {
    for (const child of Array.isArray(children) ? children : [children]) {
      if (!child || typeof child === 'string' || typeof child === 'number') continue
      if (!('props' in child)) continue

      const element = child as ReactElement<{ 'aria-label'?: string; children?: ReactNode }>
      if (typeof element.props['aria-label'] === 'string') {
        return element.props['aria-label']
      }

      const nested = findAriaLabel(element.props.children)
      if (nested) return nested
    }

    return undefined
  }

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (value: string) => void
      children: ReactNode
    }) => {
      const ariaLabel = findAriaLabel(children) ?? 'Select'
      const items = collectItems(children)

      return (
        <select
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {items.map((item) => (
            <option key={item.value} value={item.value} disabled={item.disabled}>
              {item.label}
            </option>
          ))}
        </select>
      )
    },
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

describe('ComparativosFilters', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    searchParamsValue = 'ano_base=2025&ano_comparado=2026&tipo_ordem=PMOS&fornecedor=100'
  })

  it('updates year params and clears fornecedor drill-down', async () => {
    const user = userEvent.setup()

    render(
      <ComparativosFilters
        anos={[2026, 2025, 2024]}
        anoBase={2025}
        anoComparado={2026}
        tipoOrdem="PMOS"
      />,
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Ano base' }), '2024')

    expect(replaceMock).toHaveBeenCalledWith('/admin/comparativos?ano_base=2024&ano_comparado=2026&tipo_ordem=PMOS')
  })

  it('updates tipo_ordem and removes fornecedor from the query string', async () => {
    const user = userEvent.setup()

    render(
      <ComparativosFilters
        anos={[2026, 2025, 2024]}
        anoBase={2025}
        anoComparado={2026}
        tipoOrdem="PMOS"
      />,
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo de ordem' }), 'PMPL')

    expect(replaceMock).toHaveBeenCalledWith('/admin/comparativos?ano_base=2025&ano_comparado=2026&tipo_ordem=PMPL')
  })
})
