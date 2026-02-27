interface SemaforoIdadeProps {
  dias: number
}

function getTone(dias: number): { label: string; className: string } {
  if (dias >= 7) return { label: `${dias}d`, className: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' }
  if (dias >= 3) return { label: `${dias}d`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' }
  return { label: `${dias}d`, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' }
}

export function SemaforoIdade({ dias }: SemaforoIdadeProps) {
  const tone = getTone(dias)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone.className}`}>
      {tone.label}
    </span>
  )
}
