import { AlertTriangle, BarChart3, Clock3, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrdemNotaKpis } from '@/lib/types/database'

interface OrdersKpiStripProps {
  kpis: OrdemNotaKpis
  windowDays: number
}

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function OrdersKpiStrip({ kpis, windowDays }: OrdersKpiStripProps) {
  const cards = [
    {
      id: 'total',
      label: `Ordens (${windowDays}d)`,
      value: fmt(kpis.total_ordens_30d),
      helper: 'Ordens originadas de notas',
      icon: ListChecks,
      valueClass: 'text-foreground',
    },
    {
      id: 'abertas',
      label: 'Abertas',
      value: fmt(kpis.qtd_abertas_30d),
      helper: 'Status aberto',
      icon: LoaderCircle,
      valueClass: 'text-sky-700',
    },
    {
      id: 'tratativa',
      label: 'Em tratativa',
      value: fmt(kpis.qtd_em_tratativa_30d),
      helper: 'Em processamento/execucao',
      icon: BarChart3,
      valueClass: 'text-indigo-700',
    },
    {
      id: 'concluidas',
      label: 'Concluidas',
      value: fmt(kpis.qtd_concluidas_30d),
      helper: 'Ordens encerradas',
      icon: ShieldCheck,
      valueClass: 'text-emerald-700',
    },
    {
      id: 'atrasadas',
      label: 'Atrasadas (7+)',
      value: fmt(kpis.qtd_antigas_7d_30d),
      helper: 'Semaforo vermelho',
      icon: AlertTriangle,
      valueClass: 'text-red-700',
    },
    {
      id: 'media',
      label: 'Tempo medio p/ ordem',
      value: kpis.tempo_medio_geracao_dias_30d === null
        ? '-'
        : `${kpis.tempo_medio_geracao_dias_30d.toFixed(1)} d`,
      helper: 'Dias entre nota e ordem',
      icon: Clock3,
      valueClass: 'text-amber-700',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className={`text-3xl font-bold ${item.valueClass}`}>{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.helper}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
