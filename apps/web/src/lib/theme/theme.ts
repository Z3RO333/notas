export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cockpit:theme'
const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export function parseThemePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

export function resolveSystemTheme(matchesDark: boolean): ResolvedTheme {
  return matchesDark ? 'dark' : 'light'
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return systemTheme
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return resolveSystemTheme(window.matchMedia(THEME_MEDIA_QUERY).matches)
}

export function readStoredThemePreference(storage: Storage | null | undefined): ThemePreference {
  if (!storage) return 'system'
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function writeStoredThemePreference(
  storage: Storage | null | undefined,
  preference: ThemePreference
): void {
  if (!storage) return
  try {
    storage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // no-op
  }
}

export function applyResolvedTheme(resolvedTheme: ResolvedTheme, root: HTMLElement): void {
  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.style.colorScheme = resolvedTheme
  root.dataset.themeResolved = resolvedTheme
}

export function buildThemeBootstrapScript(storageKey: string = THEME_STORAGE_KEY): string {
  const safeStorageKey = JSON.stringify(storageKey)
  const safeMediaQuery = JSON.stringify(THEME_MEDIA_QUERY)

  return `(() => {
  try {
    const root = document.documentElement;
    const stored = localStorage.getItem(${safeStorageKey});
    const preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const systemTheme = window.matchMedia(${safeMediaQuery}).matches ? 'dark' : 'light';
    const resolved = preference === 'system' ? systemTheme : preference;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    root.dataset.themePreference = preference;
    root.dataset.themeResolved = resolved;
  } catch {}
})();`
}

