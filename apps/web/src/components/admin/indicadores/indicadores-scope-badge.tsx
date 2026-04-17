interface IndicadoresScopeBadgeProps {
  isGestor: boolean
}

export function IndicadoresScopeBadge({ isGestor }: IndicadoresScopeBadgeProps) {
  if (isGestor) {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-400">
        Visão geral da operação
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-400">
      Minha carteira
    </span>
  )
}
