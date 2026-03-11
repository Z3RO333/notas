interface ChartTickPayload {
  value?: string | number | null
}

interface ChartCategoryTickProps {
  x?: number
  y?: number
  payload?: ChartTickPayload
  textAnchor?: 'start' | 'middle' | 'end'
}

interface WrappedCategoryTickOptions {
  fill: string
  fontSize: number
  fontWeight?: number
  maxCharsPerLine?: number
  maxLines?: number
  lineHeight?: number
  dx?: number
}

function splitLongToken(token: string, maxCharsPerLine: number): string[] {
  if (token.length <= maxCharsPerLine) return [token]

  const chunks: string[] = []
  for (let index = 0; index < token.length; index += maxCharsPerLine) {
    chunks.push(token.slice(index, index + maxCharsPerLine))
  }
  return chunks
}

function wrapLabel(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return ['']

  const tokens = normalized
    .split(' ')
    .flatMap((token) => splitLongToken(token, maxCharsPerLine))

  const lines: string[] = []

  for (const token of tokens) {
    const currentLine = lines[lines.length - 1] ?? ''
    const nextLine = currentLine ? `${currentLine} ${token}` : token

    if (nextLine.length <= maxCharsPerLine || currentLine.length === 0) {
      if (lines.length === 0) lines.push(nextLine)
      else lines[lines.length - 1] = nextLine
      continue
    }

    if (lines.length >= maxLines - 1) {
      lines[lines.length - 1] = `${currentLine} ${token}`.trim()
      continue
    }

    lines.push(token)
  }

  return lines
}

export function createWrappedCategoryTickRenderer(options: WrappedCategoryTickOptions) {
  const {
    fill,
    fontSize,
    fontWeight = 400,
    maxCharsPerLine = 18,
    maxLines = 2,
    lineHeight = Math.round(fontSize * 1.15),
    dx = -6,
  } = options

  return function WrappedCategoryTick({
    x = 0,
    y = 0,
    payload,
    textAnchor = 'end',
  }: ChartCategoryTickProps) {
    const rawValue = payload?.value
    const label = typeof rawValue === 'string' || typeof rawValue === 'number'
      ? String(rawValue)
      : ''
    const lines = wrapLabel(label, maxCharsPerLine, maxLines)
    const baselineOffset = Math.round(fontSize * 0.35)
    const firstLineDy = -((lines.length - 1) * lineHeight) / 2 + baselineOffset

    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={dx}
          y={0}
          fill={fill}
          fontSize={fontSize}
          fontWeight={fontWeight}
          textAnchor={textAnchor}
        >
          {lines.map((line, index) => (
            <tspan
              key={`${line}-${index}`}
              x={dx}
              dy={index === 0 ? firstLineDy : lineHeight}
            >
              {line}
            </tspan>
          ))}
        </text>
      </g>
    )
  }
}
