'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ComponentType } from 'react'
import { AlertTriangle, Clock3, ListChecks, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { updateSearchParams } from '@/lib/grid/query'
import type { CriticalityLevel, NotesKpiFilter } from '@/lib/types/database'

interface NotesKpiStripProps {
  total: number
  novas: number
  umDia: number
  doisMais: number
  activeKpi: NotesKpiFilter | null
}

function fmt(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function resolveCriticality(total: number, critical: number): CriticalityLevel {
  if (total <= 0 || critical <= 0) return 'saudavel'
  const ratio = critical / Math.max(total, 1)
  if (critical >= 20 || ratio >= 0.35) return 'critico'
  if (critical >= 6 || ratio >= 0.15) return 'atencao'
  return 'saudavel'
}

export function NotasKpiStrip({
  total,
  novas,
  umDia,
  doisMais,
  activeKpi,
}: NotesKpiStripProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const criticality = resolveCriticality(total, doisMais)

  function handleToggle(kpi: NotesKpiFilter) {
    const nextKpi = activeKpi === kpi ? null : kpi
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), {
      kpi: nextKpi,
    })
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  const cards: Array<{
    key: NotesKpiFilter
    label: string
    value: number
    icon: ComponentType<{ className?: string }>
    valueClass: string
  }> = [
    { key: 'notas', label: 'Notas', value: total, icon: ListChecks, valueClass: 'text-foreground' },
    { key: 'novas', label: '0d', value: novas, icon: Sparkles, valueClass: 'text-emerald-700' },
    { key: 'um_dia', label: '1 dia', value: umDia, icon: Clock3, valueClass: 'text-amber-700' },
    { key: 'dois_mais', label: '2+ dias', value: doisMais, icon: AlertTriangle, valueClass: 'text-red-700' },
  ]

  const frameClass = criticality === 'critico'
    ? 'border-red-300 bg-red-50/30'
    : criticality === 'atencao'
      ? 'border-amber-300 bg-amber-50/30'
      : 'border-border'

  return (
    <div className={`rounded-lg border p-2 ${frameClass}`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => {
          const Icon = item.icon
          const active = activeKpi === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleToggle(item.key)}
              className="text-left"
            >
              <Card className={`transition-all hover:shadow-sm ${active ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className={`text-3xl font-bold ${item.valueClass}`}>{fmt(item.value)}</p>
                  {active && (
                    <p className="text-xs text-muted-foreground">KPI ativo. Clique para limpar.</p>
                  )}
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>
    </div>
  )
}
