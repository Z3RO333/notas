import type { IsoFaixa, IsoAdminRow, IsoGlobal } from '@/lib/types/copilot'

// --- Faixa thresholds ---
export const ISO_FAIXA_THRESHOLDS = {
  saudavel: { min: 0, max: 24 },
  atencao: { min: 25, max: 49 },
  risco_alto: { min: 50, max: 74 },
  critico: { min: 75, max: 100 },
} as const

export function getIsoFaixa(score: number): IsoFaixa {
  if (score >= 75) return 'critico'
  if (score >= 50) return 'risco_alto'
  if (score >= 25) return 'atencao'
  return 'saudavel'
}

// --- Faixa visual config ---
export interface IsoFaixaConfig {
  label: string
  color: string
  bg: string
  border: string
  gradient: string
  pulse: boolean
}

const FAIXA_CONFIG: Record<IsoFaixa, IsoFaixaConfig> = {
  saudavel: {
    label: 'Saudavel',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    gradient: 'from-emerald-400 to-emerald-600',
    pulse: false,
  },
  atencao: {
    label: 'Atenção',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    gradient: 'from-amber-400 to-amber-600',
    pulse: false,
  },
  risco_alto: {
    label: 'Risco alto',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    gradient: 'from-orange-400 to-orange-600',
    pulse: true,
  },
  critico: {
    label: 'Critico',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    gradient: 'from-red-500 to-red-700',
    pulse: true,
  },
}

export function getIsoFaixaConfig(faixa: IsoFaixa): IsoFaixaConfig {
  return FAIXA_CONFIG[faixa]
}

// --- Client-side ISO calculation (for when views aren't available) ---

export function buildIsoGlobalFromAdmins(admins: IsoAdminRow[]): IsoGlobal {
  const totalAbertas = admins.reduce((sum, a) => sum + a.qtd_abertas, 0)
  const weightedSum = admins.reduce((sum, a) => sum + a.iso_score * a.qtd_abertas, 0)
  const score = totalAbertas > 0 ? Math.round((weightedSum / totalAbertas) * 10) / 10 : 0

  return {
    iso_score: score,
    iso_faixa: getIsoFaixa(score),
    total_admins: admins.length,
    total_abertas: totalAbertas,
    admins_criticos: admins.filter((a) => a.iso_faixa === 'critico').length,
  }
}

// --- Gauge arc helpers ---

/** Convert ISO score (0-100) to angle (0-180 degrees) for half-circle gauge */
export function isoToAngle(score: number): number {
  return Math.min(Math.max(score, 0), 100) * 1.8
}

/** Get the SVG arc color stop for a given score */
export function getIsoGaugeColor(score: number): string {
  if (score >= 75) return '#dc2626' // red-600
  if (score >= 50) return '#ea580c' // orange-600
  if (score >= 25) return '#d97706' // amber-600
  return '#059669' // emerald-600
}
