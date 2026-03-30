/* eslint-disable @next/next/no-img-element */
import type { ImgHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopNav } from './top-nav'

const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/ordens',
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}))

vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt ?? ''} {...props} />,
}))

vi.mock('@/components/theme/theme-selector', () => ({
  ThemeSelector: () => <div>Tema</div>,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn(),
    },
  }),
}))

describe('TopNav', () => {
  it('keeps viewer navigation limited to notes and orders', () => {
    render(<TopNav userName="TV Ordens" userRole="viewer" />)

    expect(screen.getByText('Painel de Notas')).toBeInTheDocument()
    expect(screen.getByText('Painel de Ordens')).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('TV Ordens')).not.toBeInTheDocument()
  })
})
