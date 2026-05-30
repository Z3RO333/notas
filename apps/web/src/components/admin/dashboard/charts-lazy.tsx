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

export const StatusBarChart = dynamic(
  () => import('./status-bar-chart').then((m) => m.StatusBarChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Status das ordens" height="h-[22rem]" />,
  },
)

export const OrdensAbertasLojaChart = dynamic(
  () => import('./ordens-abertas-loja-chart').then((m) => m.OrdensAbertasLojaChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Ordens abertas por unidade" height="h-[22rem]" />,
  },
)

export const EvolucaoMensalOperacionalChart = dynamic(
  () => import('./evolucao-mensal-operacional-chart').then((m) => m.EvolucaoMensalOperacionalChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Evolução mensal" height="h-[22rem]" />,
  },
)

export const ProdutividadeLojaChart = dynamic(
  () => import('./produtividade-loja-chart').then((m) => m.ProdutividadeLojaChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Produtividade por unidade" height="h-[22rem]" />,
  },
)
