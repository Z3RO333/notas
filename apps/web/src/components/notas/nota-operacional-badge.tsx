import type { NotaStatusOperacional } from '@/lib/types/database'

interface NotaOperacionalBadgeProps {
  statusOperacional?: NotaStatusOperacional | null
  numeroOrdemConfirmada?: string | null
}

export function NotaOperacionalBadge({
  statusOperacional,
  numeroOrdemConfirmada,
}: NotaOperacionalBadgeProps) {
  if (statusOperacional !== 'CONFIRMADA_VIROU_ORDEM') return null

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      {numeroOrdemConfirmada
        ? `Confirmada: ordem ${numeroOrdemConfirmada}`
        : 'Confirmada: virou ordem'}
    </span>
  )
}
