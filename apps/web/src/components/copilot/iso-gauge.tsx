'use client'

import { getIsoFaixaConfig, isoToAngle, getIsoGaugeColor } from '@/lib/copilot/iso'
import type { IsoFaixa } from '@/lib/types/copilot'

interface IsoGaugeProps {
  score: number
  faixa: IsoFaixa
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const SIZE_CONFIG = {
  sm: { width: 120, height: 72, strokeWidth: 8, fontSize: 20, labelSize: 10, radius: 44 },
  md: { width: 200, height: 120, strokeWidth: 12, fontSize: 32, labelSize: 13, radius: 74 },
  lg: { width: 280, height: 164, strokeWidth: 16, fontSize: 44, labelSize: 16, radius: 104 },
} as const

export function IsoGauge({ score, faixa, size = 'md', label }: IsoGaugeProps) {
  const config = SIZE_CONFIG[size]
  const faixaConfig = getIsoFaixaConfig(faixa)
  const angle = isoToAngle(score)
  const gaugeColor = getIsoGaugeColor(score)

  const cx = config.width / 2
  const cy = config.height - 8
  const r = config.radius

  // Arc path for the background (180 degrees, left to right)
  const bgArcPath = describeArc(cx, cy, r, 180, 360)
  // Arc path for the value
  const valueAngle = 180 + angle
  const valueArcPath = describeArc(cx, cy, r, 180, Math.min(valueAngle, 360))

  // Needle endpoint
  const needleAngle = ((180 + angle) * Math.PI) / 180
  const needleX = cx + (r - 4) * Math.cos(needleAngle)
  const needleY = cy + (r - 4) * Math.sin(needleAngle)

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={config.width}
        height={config.height}
        viewBox={`0 0 ${config.width} ${config.height}`}
        className={faixaConfig.pulse ? 'animate-pulse' : ''}
      >
        {/* Background arc */}
        <path
          d={bgArcPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          className="text-muted/30"
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id={`iso-gradient-${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="33%" stopColor="#d97706" />
            <stop offset="66%" stopColor="#ea580c" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>

        {/* Value arc */}
        {score > 0 && (
          <path
            d={valueArcPath}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.8s ease-out',
            }}
          />
        )}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke={gaugeColor}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={3} fill={gaugeColor} />

        {/* Score text */}
        <text
          x={cx}
          y={cy - config.radius * 0.3}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={config.fontSize}
          fontWeight="bold"
          fill={gaugeColor}
        >
          {Math.round(score)}
        </text>

        {/* Min/Max labels */}
        <text
          x={cx - r}
          y={cy + config.labelSize + 2}
          textAnchor="middle"
          fontSize={config.labelSize - 2}
          className="fill-muted-foreground"
        >
          0
        </text>
        <text
          x={cx + r}
          y={cy + config.labelSize + 2}
          textAnchor="middle"
          fontSize={config.labelSize - 2}
          className="fill-muted-foreground"
        >
          100
        </text>
      </svg>

      {/* Label */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full`}
          style={{ backgroundColor: gaugeColor }}
        />
        <span className={`text-sm font-medium ${faixaConfig.color}`}>
          {label ?? faixaConfig.label}
        </span>
      </div>
    </div>
  )
}

/** Compact ISO mini badge for inline display */
export function IsoMiniBadge({ score, faixa }: { score: number; faixa: IsoFaixa }) {
  const config = getIsoFaixaConfig(faixa)
  const color = getIsoGaugeColor(score)

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${config.bg} ${config.color} ${config.pulse ? 'animate-pulse' : ''}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      ISO {Math.round(score)}
    </span>
  )
}

// --- SVG arc helper ---

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  }
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle)
  const end = polarToCartesian(cx, cy, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
}
