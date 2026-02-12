import type { NotaPanelData, NotaStatus } from '@/lib/types/database'

export type AgingBucket = 'novo' | 'um_dia' | 'dois_mais'

const OPEN_STATUSES: NotaStatus[] = ['nova', 'em_andamento', 'encaminhada_fornecedor']

function toLocalStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseDataCriacaoSap(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseIso(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getNotaReferenceDate(nota: Pick<NotaPanelData, 'data_criacao_sap' | 'created_at'>): Date | null {
  if (nota.data_criacao_sap) {
    return parseDataCriacaoSap(nota.data_criacao_sap)
  }
  return parseIso(nota.created_at)
}

export function getAgingDays(nota: Pick<NotaPanelData, 'data_criacao_sap' | 'created_at'>, now: Date = new Date()): number {
  const ref = getNotaReferenceDate(nota)
  if (!ref) return 0

  const nowStart = toLocalStartOfDay(now)
  const refStart = toLocalStartOfDay(ref)
  const diff = Math.floor((nowStart.getTime() - refStart.getTime()) / (24 * 60 * 60 * 1000))
  return Math.max(diff, 0)
}

export function getAgingBucket(nota: Pick<NotaPanelData, 'data_criacao_sap' | 'created_at'>, now: Date = new Date()): AgingBucket {
  const days = getAgingDays(nota, now)
  if (days <= 0) return 'novo'
  if (days === 1) return 'um_dia'
  return 'dois_mais'
}

export function isOpenStatus(status: NotaStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

export function getAgingBadge(bucket: AgingBucket): { label: string; chip: string; text: string } {
  if (bucket === 'novo') {
    return {
      label: 'Novo',
      chip: 'bg-emerald-100 text-emerald-700',
      text: 'text-emerald-700',
    }
  }
  if (bucket === 'um_dia') {
    return {
      label: '1 dia',
      chip: 'bg-amber-100 text-amber-700',
      text: 'text-amber-700',
    }
  }
  return {
    label: '2+ dias',
    chip: 'bg-red-100 text-red-700',
    text: 'text-red-700',
  }
}

