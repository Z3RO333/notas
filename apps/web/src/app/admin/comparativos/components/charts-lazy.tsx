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

export const FinanceComparisonChart = dynamic(
  () => import('./finance-comparison-chart').then((m) => m.FinanceComparisonChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Comparativo financeiro" height="h-[24rem]" />,
  },
)

export const OrdersComparisonChart = dynamic(
  () => import('./orders-comparison-chart').then((m) => m.OrdersComparisonChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Comparativo de ordens" height="h-[24rem]" />,
  },
)

export const SupplierMonthlyChart = dynamic(
  () => import('./supplier-monthly-chart').then((m) => m.SupplierMonthlyChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Evolução por fornecedor" height="h-[24rem]" />,
  },
)
