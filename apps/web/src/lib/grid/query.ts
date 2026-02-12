export type QueryValue = string | number | null | undefined

export function readFirstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function parsePageParam(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.floor(parsed)
}

export function parsePageSizeParam(value: string | undefined, allowed: number[] = [20, 50, 100]): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return allowed[0]
  const normalized = Math.floor(parsed)
  return allowed.includes(normalized) ? normalized : allowed[0]
}

export function parseSortParam(
  value: string | undefined,
  fallback: { field: string; direction: 'asc' | 'desc' }
): { field: string; direction: 'asc' | 'desc' } {
  if (!value) return fallback
  const [field, direction] = value.split(':')
  if (!field) return fallback
  if (direction !== 'asc' && direction !== 'desc') return fallback
  return { field, direction }
}

export function buildSortParam(sort: { field: string; direction: 'asc' | 'desc' }): string {
  return `${sort.field}:${sort.direction}`
}

export function updateSearchParams(
  current: URLSearchParams,
  updates: Record<string, QueryValue>
): URLSearchParams {
  const next = new URLSearchParams(current.toString())

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') {
      next.delete(key)
    } else {
      next.set(key, String(value))
    }
  }

  return next
}

export function normalizeTextParam(value: string | undefined): string {
  return (value ?? '').trim()
}

export function parseYearParam(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const year = Math.floor(parsed)
  if (year < 2000 || year > 2100) return fallback
  return year
}

export function parseMonthParam(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const month = Math.floor(parsed)
  if (month < 1 || month > 12) return fallback
  return month
}

export function parseDateParam(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return ''
  const date = new Date(`${trimmed}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return trimmed
}
