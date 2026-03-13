'use client'

import {
  CHART_PERCENT_LABEL_NEGATIVE,
  CHART_PERCENT_LABEL_NEUTRAL,
  CHART_PERCENT_LABEL_POSITIVE,
} from './chart-theme'
import { formatPercentChangeLabel } from './chart-percentages'

interface ChartPercentChangeLabelProps {
  x?: number | string
  y?: number | string
  payload?: {
    deltaPct?: number | null
  }
}

function toNumber(value?: number | string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function ChartPercentChangeLabel({
  x,
  y,
  payload,
}: ChartPercentChangeLabelProps) {
  const px = toNumber(x)
  const py = toNumber(y)
  const deltaPct = payload?.deltaPct ?? null

  if (px === null || py === null || deltaPct === null) return null

  const fill = deltaPct > 0
    ? CHART_PERCENT_LABEL_POSITIVE
    : deltaPct < 0
      ? CHART_PERCENT_LABEL_NEGATIVE
      : CHART_PERCENT_LABEL_NEUTRAL

  return (
    <text
      x={px}
      y={Math.max(py - 10, 12)}
      fill={fill}
      fontSize={10}
      fontWeight={700}
      textAnchor="middle"
      pointerEvents="none"
    >
      {formatPercentChangeLabel(deltaPct)}
    </text>
  )
}

interface ChartPercentChangeBarLabelProps {
  x?: number | string
  y?: number | string
  width?: number | string
  payload?: {
    deltaPct?: number | null
  }
  showValueLabels?: boolean
}

export function ChartPercentChangeBarLabel({
  x,
  y,
  width,
  payload,
  showValueLabels = false,
}: ChartPercentChangeBarLabelProps) {
  const px = toNumber(x)
  const py = toNumber(y)
  const barWidth = toNumber(width)
  const deltaPct = payload?.deltaPct ?? null

  if (px === null || py === null || barWidth === null || deltaPct === null) return null

  const fill = deltaPct > 0
    ? CHART_PERCENT_LABEL_POSITIVE
    : deltaPct < 0
      ? CHART_PERCENT_LABEL_NEGATIVE
      : CHART_PERCENT_LABEL_NEUTRAL

  return (
    <text
      x={px + (barWidth / 2)}
      y={Math.max(py - (showValueLabels ? 22 : 10), 12)}
      fill={fill}
      fontSize={10}
      fontWeight={700}
      textAnchor="middle"
      pointerEvents="none"
    >
      {formatPercentChangeLabel(deltaPct)}
    </text>
  )
}
