import type { OrdemStatusAcomp } from '@/lib/types/database'

export type RawStatusBucket =
  | 'em_aberto'
  | 'em_execucao'
  | 'em_avaliacao'
  | 'avaliada'
  | 'nao_realizada'
  | 'concluida'
  | 'cancelada'
  | 'desconhecido'

const RAW_OPEN = new Set(['ABERTO', 'ABERTA', 'EM_PROCESSAMENTO'])
const RAW_EXECUTION = new Set([
  'EM_EXECUCAO',
  'EQUIPAMENTO_EM_CONSERTO',
  'ENVIAR_EMAIL_PFORNECEDOR',
  'EXECUCAO_INSATISFATORIO',
])
const RAW_EVALUATION = new Set(['AVALIACAO_DA_EXECUCAO', 'AVALIACAO_DE_EXECUCAO'])
const RAW_RATED = new Set(['EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA'])
const RAW_NOT_EXECUTED = 'EXECUCAO_NAO_REALIZADA'
const RAW_COMPLETED = new Set(['CONCLUIDO', 'CONCLUIDA', 'AGUARDANDO_FATURAMENTO_NF'])
const RAW_CANCELED = new Set(['CANCELADO', 'CANCELADA'])

export const RAW_ACTIVE_BUCKETS = new Set<RawStatusBucket>([
  'em_aberto',
  'em_execucao',
  'em_avaliacao',
  'nao_realizada',
  'desconhecido',
])

export const RAW_FINAL_BUCKETS = new Set<RawStatusBucket>([
  'avaliada',
  'concluida',
  'cancelada',
])

export function normalizeRawStatus(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase()
}

export function classifyRawStatusBucket(raw: string | null | undefined): RawStatusBucket {
  const normalized = normalizeRawStatus(raw)
  if (!normalized) return 'desconhecido'

  if (RAW_OPEN.has(normalized)) return 'em_aberto'
  if (RAW_EXECUTION.has(normalized)) return 'em_execucao'
  if (RAW_EVALUATION.has(normalized)) return 'em_avaliacao'
  if (RAW_RATED.has(normalized)) return 'avaliada'
  if (normalized === RAW_NOT_EXECUTED) return 'nao_realizada'
  if (RAW_COMPLETED.has(normalized)) return 'concluida'
  if (RAW_CANCELED.has(normalized)) return 'cancelada'

  return 'desconhecido'
}

export function isRawStatusBucketActive(bucket: RawStatusBucket): boolean {
  return RAW_ACTIVE_BUCKETS.has(bucket)
}

export function isRawStatusBucketFinal(bucket: RawStatusBucket): boolean {
  return RAW_FINAL_BUCKETS.has(bucket)
}

export function isRawOrderActive(raw: string | null | undefined): boolean {
  return isRawStatusBucketActive(classifyRawStatusBucket(raw))
}

export function isRawOrderFinal(raw: string | null | undefined): boolean {
  return isRawStatusBucketFinal(classifyRawStatusBucket(raw))
}

export function isRawOrderEmAberto(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'em_aberto'
}

export function isRawOrderEmExecucao(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'em_execucao'
}

export function isRawOrderEmAvaliacao(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'em_avaliacao'
}

export function isRawOrderAvaliada(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'avaliada'
}

export function isRawOrderNaoRealizada(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'nao_realizada'
}

export function isRawOrderConcluida(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'concluida'
}

export function isRawOrderCancelada(raw: string | null | undefined): boolean {
  return classifyRawStatusBucket(raw) === 'cancelada'
}

export function getRawStatusLabel(raw: string | null | undefined): string {
  const normalized = normalizeRawStatus(raw)
  switch (normalized) {
    case 'ABERTO':
    case 'ABERTA':
      return 'Aberta'
    case 'EM_PROCESSAMENTO':
      return 'Em processamento'
    case 'EM_EXECUCAO':
      return 'Em execução'
    case 'EQUIPAMENTO_EM_CONSERTO':
      return 'Equipamento em conserto'
    case 'ENVIAR_EMAIL_PFORNECEDOR':
      return 'Enviar e-mail para fornecedor'
    case 'EXECUCAO_INSATISFATORIO':
      return 'Execução insatisfatória'
    case 'AVALIACAO_DA_EXECUCAO':
    case 'AVALIACAO_DE_EXECUCAO':
      return 'Em avaliação'
    case 'EXECUCAO_SATISFATORIO':
    case 'EXECUCAO_SATISFATORIA':
      return 'Avaliada'
    case 'EXECUCAO_NAO_REALIZADA':
      return 'Não realizada'
    case 'CONCLUIDO':
    case 'CONCLUIDA':
      return 'Concluída'
    case 'AGUARDANDO_FATURAMENTO_NF':
      return 'Aguardando faturamento NF'
    case 'CANCELADO':
    case 'CANCELADA':
      return 'Cancelada'
    default:
      return normalized || 'Desconhecido'
  }
}

export function getRawStatusClass(raw: string | null | undefined): string {
  const bucket = classifyRawStatusBucket(raw)
  if (bucket === 'em_aberto') return 'bg-sky-100 text-sky-700'
  if (bucket === 'em_execucao') return 'bg-indigo-100 text-indigo-700'
  if (bucket === 'em_avaliacao') return 'bg-violet-100 text-violet-700'
  if (bucket === 'avaliada') return 'bg-emerald-100 text-emerald-700'
  if (bucket === 'nao_realizada') return 'bg-red-100 text-red-700'
  if (bucket === 'concluida') return 'bg-emerald-100 text-emerald-700'
  if (bucket === 'cancelada') return 'bg-slate-100 text-slate-600'
  return 'bg-zinc-100 text-zinc-600'
}

export function deriveOrdemStatusFromRaw(raw: string | null | undefined): OrdemStatusAcomp {
  const bucket = classifyRawStatusBucket(raw)
  if (bucket === 'em_aberto') return 'aberta'
  if (bucket === 'em_execucao' || bucket === 'em_avaliacao' || bucket === 'nao_realizada') return 'em_tratativa'
  if (bucket === 'avaliada' || bucket === 'concluida') return 'concluida'
  if (bucket === 'cancelada') return 'cancelada'
  return 'desconhecido'
}
