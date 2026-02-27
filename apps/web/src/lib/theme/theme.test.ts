import { describe, expect, it } from 'vitest'
import {
  parseThemePreference,
  resolveSystemTheme,
  resolveThemePreference,
  type ThemePreference,
} from '@/lib/theme/theme'

describe('theme utils', () => {
  it('parses valid theme preference values', () => {
    const values: ThemePreference[] = ['light', 'dark', 'system']
    for (const value of values) {
      expect(parseThemePreference(value)).toBe(value)
    }
  })

  it('falls back to system on invalid preference', () => {
    expect(parseThemePreference('')).toBe('system')
    expect(parseThemePreference('unknown')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference(undefined)).toBe('system')
  })

  it('resolves system theme from media query flag', () => {
    expect(resolveSystemTheme(true)).toBe('dark')
    expect(resolveSystemTheme(false)).toBe('light')
  })

  it('resolves effective theme for light, dark and system preference', () => {
    expect(resolveThemePreference('light', 'dark')).toBe('light')
    expect(resolveThemePreference('dark', 'light')).toBe('dark')
    expect(resolveThemePreference('system', 'light')).toBe('light')
    expect(resolveThemePreference('system', 'dark')).toBe('dark')
  })
})

