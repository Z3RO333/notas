import type { CSSProperties, ReactNode } from 'react'
import styles from './login-starfield.module.css'

interface LoginStarfieldProps {
  children: ReactNode
}

interface StarLayer {
  shadow: string
  size: number
  durationSec: number
  opacity: number
}

function mulberry32(seed: number) {
  let value = seed

  return function next() {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildStarShadow(seed: number, count: number, size: number): string {
  const rand = mulberry32(seed)
  const shadows: string[] = []

  for (let index = 0; index < count; index += 1) {
    const x = Math.floor(rand() * 2000)
    const y = Math.floor(rand() * 2000)
    const alphaBase = size === 1 ? 0.35 : size === 2 ? 0.5 : 0.7
    const alpha = (alphaBase + rand() * 0.3).toFixed(2)
    shadows.push(`${x}px ${y}px rgba(255, 255, 255, ${alpha})`)
  }

  return shadows.join(', ')
}

const STAR_LAYERS: StarLayer[] = [
  {
    shadow: buildStarShadow(11, 520, 1),
    size: 1,
    durationSec: 95,
    opacity: 0.8,
  },
  {
    shadow: buildStarShadow(29, 180, 2),
    size: 2,
    durationSec: 140,
    opacity: 0.75,
  },
  {
    shadow: buildStarShadow(47, 90, 3),
    size: 3,
    durationSec: 190,
    opacity: 0.7,
  },
]

function toLayerStyle(layer: StarLayer): CSSProperties {
  return {
    ['--star-shadow' as string]: layer.shadow,
    ['--star-size' as string]: `${layer.size}px`,
    ['--star-duration' as string]: `${layer.durationSec}s`,
    ['--star-opacity' as string]: String(layer.opacity),
  }
}

export function LoginStarfield({ children }: LoginStarfieldProps) {
  return (
    <div className={`${styles.shell} dark`}>
      <div className={styles.background} aria-hidden="true" />
      {STAR_LAYERS.map((layer) => (
        <div
          key={`${layer.size}-${layer.durationSec}`}
          className={styles.stars}
          style={toLayerStyle(layer)}
          aria-hidden="true"
        />
      ))}
      <div className={styles.content}>{children}</div>
    </div>
  )
}
