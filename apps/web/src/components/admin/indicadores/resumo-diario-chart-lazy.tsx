'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ResumoDiarioRow } from '@/lib/types/indicadores'

const ResumoDiarioChart = dynamic(
  () => import('./resumo-diario-chart').then((module) => module.ResumoDiarioChart),
  {
    ssr: false,
    loading: () => (
      <Card className="border-border/60 bg-background/75">
        <CardHeader>
          <CardTitle className="text-base">Resumo diário</CardTitle>
          <CardDescription>
            Entradas, conversões e conclusões distribuídas por dia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[22rem] w-full rounded-2xl" />
        </CardContent>
      </Card>
    ),
  },
)

interface ResumoDiarioChartLazyProps {
  rows: ResumoDiarioRow[]
}

export function ResumoDiarioChartLazy({ rows }: ResumoDiarioChartLazyProps) {
  return <ResumoDiarioChart rows={rows} />
}
