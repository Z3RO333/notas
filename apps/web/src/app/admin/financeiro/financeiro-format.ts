export const FINANCEIRO_MONTH_LABELS: Record<number, string> = {
  1: 'Jan',
  2: 'Fev',
  3: 'Mar',
  4: 'Abr',
  5: 'Mai',
  6: 'Jun',
  7: 'Jul',
  8: 'Ago',
  9: 'Set',
  10: 'Out',
  11: 'Nov',
  12: 'Dez',
}

export function formatCurrencyBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCurrencyCompactBRL(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(1)} mi`
  }
  if (abs >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(0)} mil`
  }
  return formatCurrencyBRL(value)
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}
