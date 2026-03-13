import { ArrowDownRight, ArrowRightLeft, ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ComparisonKpiItem } from '../comparativos-utils'
import { formatDeltaPercent } from '../comparativos-utils'

interface ComparisonKpiStripProps {
  items: ComparisonKpiItem[]
  formatValue: (value: number) => string
}

function getDeltaLabel(item: ComparisonKpiItem): string {
  if (item.deltaAbs > 0) return `A mais vs ${item.anoBase}`
  if (item.deltaAbs < 0) return `A menos vs ${item.anoBase}`
  return `Mesmo nivel de ${item.anoBase}`
}

function getDeltaClass(value: number): string {
  if (value > 0) return 'text-rose-600'
  if (value < 0) return 'text-emerald-600'
  return 'text-muted-foreground'
}

function DeltaIcon({ value }: { value: number }) {
  if (value > 0) return <ArrowUpRight className="h-3.5 w-3.5" />
  if (value < 0) return <ArrowDownRight className="h-3.5 w-3.5" />
  return <ArrowRightLeft className="h-3.5 w-3.5" />
}

export function ComparisonKpiStrip({ items, formatValue }: ComparisonKpiStripProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const deltaClass = getDeltaClass(item.deltaAbs)
        const deltaLabel = getDeltaLabel(item)
        const deltaValue = Math.abs(item.deltaAbs)
        return (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {item.anoBase}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {formatValue(item.valorBase)}
                  </p>
                </div>
                <div className="rounded-lg border bg-primary/5 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {item.anoComparado}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {formatValue(item.valorComparado)}
                  </p>
                </div>
              </div>

              <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${deltaClass}`}>
                <span className="inline-flex items-center gap-1 font-medium">
                  <DeltaIcon value={item.deltaAbs} />
                  {deltaLabel}
                </span>
                <div className="text-right">
                  <p className="tabular-nums">{formatValue(deltaValue)}</p>
                  <p className="text-xs">{formatDeltaPercent(item.deltaPct)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
