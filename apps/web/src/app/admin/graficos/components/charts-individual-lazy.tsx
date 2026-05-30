'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function ChartCardSkeleton({ title, height }: { title: string; height: string }) {
  return (
    <Card className="border-border/60 bg-background/75">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className={`w-full rounded-2xl ${height}`} />
      </CardContent>
    </Card>
  )
}

export const TopLojasChart = dynamic(
  () => import('./top-lojas-chart').then((m) => m.TopLojasChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Top unidades" height="h-[26rem]" />,
  },
)

export const TopServicosChart = dynamic(
  () => import('./top-servicos-chart').then((m) => m.TopServicosChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Top serviços" height="h-[26rem]" />,
  },
)

export const EvolucaoMensalChart = dynamic(
  () => import('./evolucao-mensal-chart').then((m) => m.EvolucaoMensalChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Evolução mensal" height="h-[24rem]" />,
  },
)
