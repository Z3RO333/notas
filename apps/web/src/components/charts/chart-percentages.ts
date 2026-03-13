export function calculatePercentChange(baseValue: number, comparedValue: number): number | null {
  if (!Number.isFinite(baseValue) || !Number.isFinite(comparedValue)) return null
  if (baseValue === 0 && comparedValue === 0) return 0
  if (baseValue === 0) return null
  return ((comparedValue - baseValue) / baseValue) * 100
}

export function calculateShare(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0
  return (value / total) * 100
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`
}

export function formatSignedPercentChange(value: number | null, digits = 1): string {
  if (value === null) return 'Sem base'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function formatPercentChangeLabel(value: number | null): string {
  if (value === null) return ''
  const digits = Math.abs(value) >= 100 ? 0 : 1
  return formatSignedPercentChange(value, digits)
}

export function formatTrendDescription(value: number | null, digits = 1): string {
  if (value === null) return 'Sem base anterior'
  if (value > 0) return `Subida de +${value.toFixed(digits)}%`
  if (value < 0) return `Queda de ${value.toFixed(digits)}%`
  return `Estavel em ${value.toFixed(digits)}%`
}
