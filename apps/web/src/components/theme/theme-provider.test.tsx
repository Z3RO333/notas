import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '@/components/theme/theme-provider'
import { THEME_STORAGE_KEY } from '@/lib/theme/theme'

function setupMatchMedia(initialDark: boolean) {
  let matches = initialDark
  const listeners = new Set<(event: MediaQueryListEvent) => void>()

  const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
    media: query,
    get matches() {
      return matches
    },
    onchange: null,
    addEventListener: (type: string, callback: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.add(callback)
    },
    removeEventListener: (type: string, callback: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.delete(callback)
    },
    addListener: (callback: (event: MediaQueryListEvent) => void) => {
      listeners.add(callback)
    },
    removeListener: (callback: (event: MediaQueryListEvent) => void) => {
      listeners.delete(callback)
    },
    dispatchEvent: () => true,
  }))

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaMock,
  })

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      const event = { matches: nextMatches, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  }
}

function ThemeHarness() {
  const { themePreference, resolvedTheme, setThemePreference } = useTheme()
  return (
    <div>
      <span data-testid="preference">{themePreference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setThemePreference('light')}>light</button>
      <button type="button" onClick={() => setThemePreference('dark')}>dark</button>
      <button type="button" onClick={() => setThemePreference('system')}>system</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.themeResolved
  })

  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.themeResolved
  })

  it('falls back to system when stored preference is invalid', async () => {
    setupMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid')

    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('preference')).toHaveTextContent('system')
      expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applies dark class and stores preference on explicit change', async () => {
    setupMatchMedia(false)
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>
    )

    await user.click(screen.getByRole('button', { name: 'dark' }))

    await waitFor(() => {
      expect(screen.getByTestId('preference')).toHaveTextContent('dark')
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    })
  })

  it('updates resolved theme on system preference when OS theme changes', async () => {
    const media = setupMatchMedia(false)
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>
    )

    await user.click(screen.getByRole('button', { name: 'system' }))

    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    })

    act(() => {
      media.setMatches(true)
    })

    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  it('syncs preference changes from other tabs via storage event', async () => {
    setupMatchMedia(false)
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>
    )

    await user.click(screen.getByRole('button', { name: 'dark' }))
    await waitFor(() => {
      expect(screen.getByTestId('preference')).toHaveTextContent('dark')
    })

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: THEME_STORAGE_KEY,
        newValue: 'light',
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('preference')).toHaveTextContent('light')
      expect(screen.getByTestId('resolved')).toHaveTextContent('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })
})
