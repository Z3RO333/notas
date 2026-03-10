'use client'

type LabelValue = number | string
type ChartScalar = number | string

interface InsideBarLabelRendererProps {
  x?: ChartScalar
  y?: ChartScalar
  width?: ChartScalar
  height?: ChartScalar
  value?: LabelValue
}

interface CreateInsideBarLabelRendererOptions {
  fill: string
  fontSize?: number
  fontWeight?: number
  paddingX?: number
  minHeight?: number
  fallbackPosition?: 'none' | 'barStart' | 'segmentEnd'
  fallbackOffset?: number
  fallbackFill?: string
  fallbackStroke?: string
  fallbackStrokeWidth?: number
  formatter?: (value: LabelValue) => string
}

const CHAR_WIDTH_ESTIMATE = 0.64

function toNumber(value: ChartScalar | undefined) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function createInsideBarLabelRenderer(options: CreateInsideBarLabelRendererOptions) {
  const fontSize = options.fontSize ?? 10
  const fontWeight = options.fontWeight ?? 600
  const paddingX = options.paddingX ?? 7
  const minHeight = options.minHeight ?? fontSize + 2

  return function InsideBarLabel({
    x,
    y,
    width,
    height,
    value,
  }: InsideBarLabelRendererProps) {
    const xValue = toNumber(x)
    const yValue = toNumber(y)
    const widthValue = toNumber(width)
    const heightValue = toNumber(height)

    if (
      xValue === null ||
      yValue === null ||
      widthValue === null ||
      heightValue === null
    ) {
      return null
    }

    if (value === null || value === undefined || value === '') {
      return null
    }

    const label = options.formatter ? options.formatter(value) : String(value)
    if (!label) {
      return null
    }

    const estimatedTextWidth = label.length * fontSize * CHAR_WIDTH_ESTIMATE
    const minSegmentWidth = estimatedTextWidth + paddingX * 2

    if (widthValue < minSegmentWidth || heightValue < minHeight) {
      return null
    }

    return (
      <text
        x={xValue + paddingX}
        y={yValue + heightValue / 2}
        fill={options.fill}
        fontSize={fontSize}
        fontWeight={fontWeight}
        textAnchor="start"
        dominantBaseline="middle"
        pointerEvents="none"
      >
        {label}
      </text>
    )
  }
}

export function createAdaptiveBarLabelRenderer(options: CreateInsideBarLabelRendererOptions) {
  const fontSize = options.fontSize ?? 10
  const fontWeight = options.fontWeight ?? 600
  const paddingX = options.paddingX ?? 7
  const minHeight = options.minHeight ?? fontSize + 2
  const fallbackPosition = options.fallbackPosition ?? 'none'
  const fallbackOffset = options.fallbackOffset ?? 6
  const fallbackFill = options.fallbackFill ?? options.fill
  const fallbackStroke = options.fallbackStroke ?? 'hsl(var(--background))'
  const fallbackStrokeWidth = options.fallbackStrokeWidth ?? 3

  return function InsideBarLabel({
    x,
    y,
    width,
    height,
    value,
  }: InsideBarLabelRendererProps) {
    const xValue = toNumber(x)
    const yValue = toNumber(y)
    const widthValue = toNumber(width)
    const heightValue = toNumber(height)

    if (
      xValue === null ||
      yValue === null ||
      widthValue === null ||
      heightValue === null
    ) {
      return null
    }

    if (value === null || value === undefined || value === '') {
      return null
    }

    const label = options.formatter ? options.formatter(value) : String(value)
    if (!label) {
      return null
    }

    const estimatedTextWidth = label.length * fontSize * CHAR_WIDTH_ESTIMATE
    const minSegmentWidth = estimatedTextWidth + paddingX * 2

    if (heightValue < minHeight) {
      return null
    }

    if (widthValue < minSegmentWidth) {
      if (fallbackPosition === 'none') {
        return null
      }

      const fallbackX =
        fallbackPosition === 'barStart'
          ? xValue + fallbackOffset
          : xValue + widthValue + fallbackOffset

      return (
        <text
          x={fallbackX}
          y={yValue + heightValue / 2}
          fill={fallbackFill}
          fontSize={fontSize}
          fontWeight={fontWeight}
          textAnchor="start"
          dominantBaseline="middle"
          pointerEvents="none"
          stroke={fallbackStroke}
          strokeWidth={fallbackStrokeWidth}
          paintOrder="stroke"
        >
          {label}
        </text>
      )
    }

    return (
      <text
        x={xValue + paddingX}
        y={yValue + heightValue / 2}
        fill={options.fill}
        fontSize={fontSize}
        fontWeight={fontWeight}
        textAnchor="start"
        dominantBaseline="middle"
        pointerEvents="none"
      >
        {label}
      </text>
    )
  }
}

export function getPositiveDomainMax(values: number[], headroomFactor = 0.08, minHeadroom = 4) {
  const maxValue = values.reduce((currentMax, value) => Math.max(currentMax, value), 0)

  if (maxValue <= 0) {
    return 1
  }

  return maxValue + Math.max(minHeadroom, Math.ceil(maxValue * headroomFactor))
}
