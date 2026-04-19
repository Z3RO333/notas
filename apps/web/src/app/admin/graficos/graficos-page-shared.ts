import type {
  GestaoEvolucaoMes,
  GestaoSegmentoSummary,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'

export interface ResolvedPeriodoIndicadores {
  startDate: string
  endDate: string
  startIso: string
  endExclusiveIso: string
}

export interface ResolvedGraficosFilters {
  currentYear: number
  ano?: number
  mes?: number
  tipoOrdem?: string
  nomeLoja?: string
  textoBreve?: string
}

export function resolvePeriodoIndicadores(params: Record<string, string | undefined>): ResolvedPeriodoIndicadores {
  const now = new Date()
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const toDateStr = (value: Date) => value.toISOString().slice(0, 10)

  const startDate = params.start ?? toDateStr(defaultStart)
  const endDate = params.end ?? toDateStr(defaultEnd)

  const endExclusive = new Date(endDate)
  endExclusive.setDate(endExclusive.getDate() + 1)

  return {
    startDate,
    endDate,
    startIso: `${startDate}T00:00:00+00:00`,
    endExclusiveIso: `${toDateStr(endExclusive)}T00:00:00+00:00`,
  }
}

export function resolveGraficosFilters(params: Record<string, string | undefined>): ResolvedGraficosFilters {
  const currentYear = new Date().getFullYear()
  const parsedAno = params.ano && params.ano !== 'todos' ? parseInt(params.ano, 10) : NaN
  const parsedMes = params.mes && params.mes !== 'todos' ? parseInt(params.mes, 10) : NaN

  return {
    currentYear,
    ano: params.ano === 'todos'
      ? undefined
      : Number.isFinite(parsedAno)
        ? parsedAno
        : currentYear,
    mes: Number.isFinite(parsedMes) ? parsedMes : undefined,
    tipoOrdem: params.tipo_ordem ?? undefined,
    nomeLoja: params.loja ?? undefined,
    textoBreve: params.servico ?? undefined,
  }
}

export const MES_LABELS: Record<number, string> = {
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

export const TIPO_LABEL: Record<TipoUnidade, string> = {
  LOJA: 'Lojas',
  FARMA: 'Farmas',
  CD: 'CDs',
}

export const TIPOS: TipoUnidade[] = ['LOJA', 'FARMA', 'CD']

export type TopLojasRaw = {
  nome_loja: string
  tipo_unidade: string
  concluidas: number
  em_aberto: number
  total_ordens: number
}

export type TopServRaw = Pick<GestaoTopServico, 'texto_breve' | 'total_ordens'> & {
  tipo_unidade: string | null
}

export type EvolucaoRaw = Pick<GestaoEvolucaoMes, 'ano' | 'mes' | 'total_ordens' | 'total_notas'> & {
  tipo_unidade: string | null
}

export type SegRaw = Pick<GestaoSegmentoSummary, 'total_ordens' | 'total_notas' | 'unidades'> & {
  tipo_unidade: string | null
}

export type OpcoesRaw = {
  tipo_ordem: string | null
  ano: number | null
}
