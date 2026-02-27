import { Building2, ClipboardList, Hammer, LayoutGrid } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GestaoKpis, TipoUnidade } from '@/lib/types/database'

const UNIDADE_LABEL: Record<TipoUnidade, string> = {
  LOJA: 'Lojas Ativas',
  FARMA: 'Farmas Ativas',
  CD: 'CDs Ativos',
}

interface GestaoKpiStripProps {
  kpis: GestaoKpis
  tipoUnidade?: TipoUnidade
}

export function GestaoKpiStrip({ kpis, tipoUnidade }: GestaoKpiStripProps) {
  const unidadesLabel = tipoUnidade ? UNIDADE_LABEL[tipoUnidade] : 'Unidades Ativas'
  const items = [
    {
      key: 'total_ordens' as const,
      label: 'Total de Ordens',
      icon: Hammer,
      helper: 'Ordens geradas no período filtrado',
    },
    {
      key: 'total_notas' as const,
      label: 'Total de Notas',
      icon: ClipboardList,
      helper: 'Notas de manutenção registradas',
    },
    {
      key: 'lojas_ativas' as const,
      label: unidadesLabel,
      icon: Building2,
      helper: 'Unidades com pelo menos 1 ordem',
    },
    {
      key: 'servicos_unicos' as const,
      label: 'Tipos de Serviço',
      icon: LayoutGrid,
      helper: 'Serviços distintos solicitados',
    },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className="h-4 w-4 text-slate-500" />
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-bold text-foreground">
                {kpis[item.key].toLocaleString('pt-BR')}
              </div>
              <p className="text-xs text-muted-foreground">{item.helper}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
