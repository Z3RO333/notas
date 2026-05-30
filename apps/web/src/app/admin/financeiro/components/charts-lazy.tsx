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

export const FinanceiroMonthlyChart = dynamic(
  () => import('./financeiro-monthly-chart').then((m) => m.FinanceiroMonthlyChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Evolução mensal" height="h-[24rem]" />,
  },
)

export const FinanceiroCostByUnitChart = dynamic(
  () => import('./financeiro-cost-by-unit-chart').then((m) => m.FinanceiroCostByUnitChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Custo por unidade" height="h-[24rem]" />,
  },
)

export const CartaoMonthlyChart = dynamic(
  () => import('./cartao-monthly-chart').then((m) => m.CartaoMonthlyChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Gastos mensais" height="h-[24rem]" />,
  },
)
