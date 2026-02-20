import type { MedalType, TendenciaType, ProductivityDetailRow } from '@/lib/types/copilot'

/** Assign medals to top 3 by concluidas_30d */
export function assignMedals(rows: ProductivityDetailRow[]): ProductivityDetailRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.concluidas_30d !== a.concluidas_30d) return b.concluidas_30d - a.concluidas_30d
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })

  const medals: MedalType[] = ['ouro', 'prata', 'bronze']

  return sorted.map((row, i) => ({
    ...row,
    medal: i < 3 && row.concluidas_30d > 0 ? medals[i] : null,
  }))
}

/** Determine trend based on variation percentage */
export function getTendencia(variacaoPct: number): TendenciaType {
  if (variacaoPct > 10) return 'subindo'
  if (variacaoPct < -10) return 'caindo'
  return 'estavel'
}

export interface MedalConfig {
  emoji: string
  label: string
  color: string
  bg: string
}

const MEDAL_CONFIG: Record<Exclude<MedalType, null>, MedalConfig> = {
  ouro: { emoji: '1', label: 'Ouro', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  prata: { emoji: '2', label: 'Prata', color: 'text-slate-600', bg: 'bg-slate-100' },
  bronze: { emoji: '3', label: 'Bronze', color: 'text-orange-700', bg: 'bg-orange-100' },
}

export function getMedalConfig(medal: MedalType): MedalConfig | null {
  if (!medal) return null
  return MEDAL_CONFIG[medal]
}

export interface TendenciaConfig {
  label: string
  icon: string
  color: string
}

const TENDENCIA_CONFIG: Record<TendenciaType, TendenciaConfig> = {
  subindo: { label: 'Subindo', icon: 'arrow-up', color: 'text-emerald-600' },
  estavel: { label: 'Estável', icon: 'minus', color: 'text-slate-500' },
  caindo: { label: 'Caindo', icon: 'arrow-down', color: 'text-red-600' },
}

export function getTendenciaConfig(tendencia: TendenciaType): TendenciaConfig {
  return TENDENCIA_CONFIG[tendencia]
}

/** Build productivity rows from raw SQL view data */
export function buildProductivityDetailRows(
  rawRows: Array<{
    administrador_id: string
    nome: string
    avatar_url: string | null
    especialidade: string | null
    concluidas_7d: number
    concluidas_30d: number
    concluidas_prev_30d: number
    media_diaria_30d: number
    variacao_pct: number
    eficiencia: number
  }>
): ProductivityDetailRow[] {
  const rows: ProductivityDetailRow[] = rawRows.map((r) => ({
    ...r,
    medal: null,
    tendencia: getTendencia(r.variacao_pct),
  }))

  return assignMedals(rows)
}
