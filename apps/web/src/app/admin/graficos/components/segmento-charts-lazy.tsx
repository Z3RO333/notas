'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  GestaoEvolucaoMes,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'

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

const TopLojasChart = dynamic(
  () => import('./top-lojas-chart').then((module) => module.TopLojasChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Top unidades" height="h-[26rem]" />,
  },
)

const TopServicosChart = dynamic(
  () => import('./top-servicos-chart').then((module) => module.TopServicosChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Top serviços" height="h-[26rem]" />,
  },
)

const EvolucaoMensalChart = dynamic(
  () => import('./evolucao-mensal-chart').then((module) => module.EvolucaoMensalChart),
  {
    ssr: false,
    loading: () => <ChartCardSkeleton title="Evolução mensal" height="h-[24rem]" />,
  },
)

interface SegmentoChartsLazyProps {
  tipo: TipoUnidade
  topLojas: GestaoTopLoja[]
  topServicos: GestaoTopServico[]
  evolucao: GestaoEvolucaoMes[]
  ano?: number
  mes?: number
  tipoOrdem?: string
}

export function SegmentoChartsLazy({
  tipo,
  topLojas,
  topServicos,
  evolucao,
  ano,
  mes,
  tipoOrdem,
}: SegmentoChartsLazyProps) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TopLojasChart
          data={topLojas}
          tipoUnidade={tipo}
          ano={ano}
          mes={mes}
          tipoOrdem={tipoOrdem}
        />
        <TopServicosChart
          data={topServicos}
          ano={ano}
          mes={mes}
          tipoOrdem={tipoOrdem}
          tipoUnidade={tipo}
        />
      </div>

      <EvolucaoMensalChart data={evolucao} />
    </>
  )
}
