import {
  Activity,
  BriefcaseBusiness,
  ClipboardCheck,
  Clock3,
  Gauge,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { KpisNotasOrdens } from '@/lib/types/indicadores'

interface KpiCardProps {
  label: string
  value: string
  sublabel: string
  accentClass: string
  icon: LucideIcon
}

function KpiCard({ label, value, sublabel, accentClass, icon: Icon }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/75 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
        </div>
        <div className={`rounded-2xl border px-3 py-2 ${accentClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {sublabel}
      </p>
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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="Notas recebidas"
        value={kpis.total_notas.toLocaleString('pt-BR')}
        sublabel="Notas distribuidas no recorte atual."
        accentClass="border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300"
        icon={ClipboardCheck}
      />
      <KpiCard
        label="Convertidas em ordem"
        value={kpis.notas_convertidas.toLocaleString('pt-BR')}
        sublabel={`${formatPercent(kpis.taxa_conversao)} do total virou ordem.`}
        accentClass="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
        icon={BriefcaseBusiness}
      />
      <KpiCard
        label="Taxa de conversão"
        value={formatPercent(kpis.taxa_conversao)}
        sublabel="Efetividade do funil de entrada."
        accentClass="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        icon={Gauge}
      />
      <KpiCard
        label="Tempo medio nota->ordem"
        value={formatDias(kpis.tempo_medio_nota_ordem)}
        sublabel="Velocidade média de conversão."
        accentClass="border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300"
        icon={Clock3}
      />
      <KpiCard
        label="Tempo de conclusão (mediana)"
        value={formatDias(kpis.tempo_medio_conclusao)}
        sublabel="Mediana de dias da entrada ao encerramento (só CONCLUIDO/CANCELADO)."
        accentClass="border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
        icon={Activity}
      />
      <KpiCard
        label="Ordens concluidas"
        value={kpis.total_ordens_concluidas.toLocaleString('pt-BR')}
        sublabel="Ordens encerradas dentro do periodo."
        accentClass="border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300"
        icon={ShieldCheck}
      />
    </div>
  )
}
