import { describe, expect, it } from 'vitest'
import {
  calculatePercentChange,
  calculateShare,
  formatPercent,
  formatPercentChangeLabel,
  formatSignedPercentChange,
  formatTrendDescription,
} from './chart-percentages'

describe('chart-percentages', () => {
  it('calculates positive, negative and zero-based changes safely', () => {
    expect(calculatePercentChange(100, 125)).toBeCloseTo(25)
    expect(calculatePercentChange(100, 75)).toBeCloseTo(-25)
    expect(calculatePercentChange(0, 0)).toBe(0)
    expect(calculatePercentChange(0, 30)).toBeNull()
  })

  it('calculates chart shares and formats percentages consistently', () => {
    expect(calculateShare(25, 200)).toBeCloseTo(12.5)
    expect(calculateShare(25, 0)).toBe(0)
    expect(formatPercent(12.5)).toBe('12.5%')
    expect(formatSignedPercentChange(12.5)).toBe('+12.5%')
    expect(formatSignedPercentChange(-12.5)).toBe('-12.5%')
    expect(formatSignedPercentChange(null)).toBe('Sem base')
    expect(formatPercentChangeLabel(12.5)).toBe('+12.5%')
    expect(formatPercentChangeLabel(125.4)).toBe('+125%')
    expect(formatPercentChangeLabel(null)).toBe('')
  })

  it('describes upward, downward and flat trends', () => {
    expect(formatTrendDescription(8.3)).toBe('Subida de +8.3%')
    expect(formatTrendDescription(-4.2)).toBe('Queda de -4.2%')
    expect(formatTrendDescription(0)).toBe('Estavel em 0.0%')
    expect(formatTrendDescription(null)).toBe('Sem base anterior')
  })
})
