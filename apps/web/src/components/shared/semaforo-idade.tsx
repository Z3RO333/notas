interface SemaforoIdadeProps {
  dias: number
}

function getTone(dias: number): { label: string; className: string } {
  if (dias >= 7) return { label: `${dias}d`, className: 'bg-red-100 text-red-700' }
  if (dias >= 3) return { label: `${dias}d`, className: 'bg-amber-100 text-amber-700' }
  return { label: `${dias}d`, className: 'bg-emerald-100 text-emerald-700' }
}

export function SemaforoIdade({ dias }: SemaforoIdadeProps) {
  const tone = getTone(dias)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone.className}`}>
      {tone.label}
    </span>
  )
}
