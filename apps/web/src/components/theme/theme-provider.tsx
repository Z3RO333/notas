'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  getSystemTheme,
  parseThemePreference,
  readStoredThemePreference,
  resolveSystemTheme,
  resolveThemePreference,
  writeStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme/theme'

interface ThemeContextValue {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  setThemePreference: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

interface ThemeProviderProps {
  children: ReactNode
}

function getInitialThemePreference(): ThemePreference {
  if (typeof document !== 'undefined') {
    const fromDataset = parseThemePreference(document.documentElement.dataset.themePreference)
    if (fromDataset !== 'system') return fromDataset
  }

  if (typeof window === 'undefined') return 'system'
  return readStoredThemePreference(window.localStorage)
}

function getInitialSystemTheme(): ResolvedTheme {
  if (typeof document !== 'undefined') {
    const fromDataset = document.documentElement.dataset.themeResolved
    if (fromDataset === 'light' || fromDataset === 'dark') return fromDataset
  }
  return getSystemTheme()
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getInitialThemePreference())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getInitialSystemTheme())

  const resolvedTheme = useMemo(
    () => resolveThemePreference(themePreference, systemTheme),
    [themePreference, systemTheme]
  )

  useEffect(() => {
    const root = document.documentElement
    applyResolvedTheme(resolvedTheme, root)
    root.dataset.themePreference = themePreference
    writeStoredThemePreference(window.localStorage, themePreference)
  }, [themePreference, resolvedTheme])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(resolveSystemTheme(event.matches))
    }

    setSystemTheme(resolveSystemTheme(mediaQuery.matches))

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange)
      return () => mediaQuery.removeEventListener('change', onChange)
    }

    mediaQuery.addListener(onChange)
    return () => mediaQuery.removeListener(onChange)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      setThemePreferenceState(parseThemePreference(event.newValue))
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setThemePreference = useCallback((nextTheme: ThemePreference) => {
    setThemePreferenceState(parseThemePreference(nextTheme))
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({
    themePreference,
    resolvedTheme,
    setThemePreference,
  }), [themePreference, resolvedTheme, setThemePreference])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}

