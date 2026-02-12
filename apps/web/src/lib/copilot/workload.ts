import type { WorkloadStatus, WorkloadRadarRow } from '@/lib/types/copilot'

export interface WorkloadStatusConfig {
  label: string
  color: string
  bg: string
  border: string
}

const STATUS_CONFIG: Record<WorkloadStatus, WorkloadStatusConfig> = {
  ocioso: {
    label: 'Ocioso',
    color: 'text-sky-700',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
  },
  equilibrado: {
    label: 'Equilibrado',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  carregado: {
    label: 'Carregado',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  sobrecarregado: {
    label: 'Sobrecarregado',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
  },
}

export function getWorkloadStatusConfig(status: WorkloadStatus): WorkloadStatusConfig {
  return STATUS_CONFIG[status]
}

export function getWorkloadStatus(qtdAbertas: number, maxNotas: number): WorkloadStatus {
  if (maxNotas <= 0) return 'ocioso'
  const ratio = qtdAbertas / maxNotas
  if (ratio >= 0.9) return 'sobrecarregado'
  if (ratio >= 0.7) return 'carregado'
  if (ratio >= 0.3) return 'equilibrado'
  return 'ocioso'
}

/** Sort radar rows: sobrecarregados first, then by ISO desc */
export function sortRadarRows(rows: WorkloadRadarRow[]): WorkloadRadarRow[] {
  const statusOrder: Record<WorkloadStatus, number> = {
    sobrecarregado: 0,
    carregado: 1,
    equilibrado: 2,
    ocioso: 3,
  }

  return [...rows].sort((a, b) => {
    const statusDiff = statusOrder[a.workload_status] - statusOrder[b.workload_status]
    if (statusDiff !== 0) return statusDiff
    return b.iso_score - a.iso_score
  })
}
