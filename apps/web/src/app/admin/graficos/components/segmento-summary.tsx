import { ShoppingBag, Pill, Warehouse } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { GestaoSegmentoSummary } from '@/lib/types/database'

interface SegmentoSummaryProps {
  segmentos: GestaoSegmentoSummary[]
}

const CONFIG = {
  LOJA: { label: 'Lojas', icon: ShoppingBag, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  FARMA: { label: 'Farmas', icon: Pill, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  CD: { label: 'CDs', icon: Warehouse, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
} as const

export function SegmentoSummary({ segmentos }: SegmentoSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {segmentos.map((seg) => {
        const cfg = CONFIG[seg.tipo]
        const Icon = cfg.icon

        return (
          <Card key={seg.tipo} className={`border-0 ${cfg.bg}`}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between mb-3">
                <div className={`rounded-lg p-2 bg-white/60 dark:bg-black/20`}>
                  <Icon className={`h-5 w-5 ${cfg.color}`} />
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-white/60 dark:bg-black/20 rounded px-2 py-1">
                  {seg.percentual_ordens.toFixed(1)}% do total
                </span>
              </div>
              <div className="space-y-0.5">
                <p className={`text-2xl font-bold ${cfg.color}`}>
                  {seg.total_ordens.toLocaleString('pt-BR')}
                </p>
                <p className="text-sm font-medium text-foreground">{cfg.label}</p>
                <p className="text-xs text-muted-foreground">
                  {seg.unidades} unidade{seg.unidades !== 1 ? 's' : ''} · {seg.total_notas.toLocaleString('pt-BR')} nota{seg.total_notas !== 1 ? 's' : ''}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
