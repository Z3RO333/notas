import type { KpisNotasOrdens } from '@/lib/types/indicadores'

interface KpiCardProps {
  label: string
  value: string
  sublabel: string
  colorClass: string
}

function KpiCard({ label, value, sublabel, colorClass }: KpiCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-lg border bg-card p-3 ${colorClass}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{sublabel}</p>
    </div>
  )
}

function formatDecimal(valor: number): string {
  const fixed = valor.toFixed(1)
  return fixed.replace('.', ',')
}

function formatDias(valor: number | null): string {
  if (valor === null) return '—'
  return `${formatDecimal(valor)}d`
}

function formatPercent(valor: number): string {
  return `${formatDecimal(valor)}%`
}

interface KpiStripProps {
  kpis: KpisNotasOrdens
}

export function KpiStrip({ kpis }: KpiStripProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        label="Notas recebidas"
        value={String(kpis.total_notas)}
        sublabel="no período"
        colorClass="border-l-2 border-l-blue-500"
      />
      <KpiCard
        label="Convertidas em ordem"
        value={String(kpis.notas_convertidas)}
        sublabel={`${formatPercent(kpis.taxa_conversao)} do total`}
        colorClass="border-l-2 border-l-green-500"
      />
      <KpiCard
        label="Taxa de conversão"
        value={formatPercent(kpis.taxa_conversao)}
        sublabel="notas → ordens"
        colorClass="border-l-2 border-l-amber-500"
      />
      <KpiCard
        label="Tempo médio nota→ordem"
        value={formatDias(kpis.tempo_medio_nota_ordem)}
        sublabel="média do período"
        colorClass="border-l-2 border-l-violet-500"
      />
      <KpiCard
        label="Tempo médio conclusão"
        value={formatDias(kpis.tempo_medio_conclusao)}
        sublabel="geração ao encerramento"
        colorClass="border-l-2 border-l-cyan-500"
      />
      <KpiCard
        label="Ordens concluídas"
        value={String(kpis.total_ordens_concluidas)}
        sublabel="no período"
        colorClass="border-l-2 border-l-rose-500"
      />
    </div>
  )
}
