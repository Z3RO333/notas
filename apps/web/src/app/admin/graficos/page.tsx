import { Suspense } from 'react'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { GraficosGestaoSectionServer } from './components/graficos-gestao-section-server'
import { GraficosIndicadoresSectionServer } from './components/graficos-indicadores-section-server'
import {
  GraficosGestaoSectionSkeleton,
  GraficosIndicadoresSectionSkeleton,
} from './components/graficos-section-skeletons'

export const dynamic = 'force-dynamic'

interface GraficosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function GraficosPage({ searchParams }: GraficosPageProps) {
  const params = (await searchParams) ?? {}
  const adminCtx = await getCurrentAdminContext()

  return (
    <div className="space-y-8">
      <PageTitleBlock
        title="Gráficos Gerenciais"
        subtitle="Padrões, recorrência e ranking por unidade."
      />

      <Suspense fallback={<GraficosIndicadoresSectionSkeleton />}>
        <GraficosIndicadoresSectionServer
          params={params}
          adminCtx={{
            isGestor: adminCtx.isGestor,
            adminId: adminCtx.adminId,
          }}
        />
      </Suspense>

      <Suspense fallback={<GraficosGestaoSectionSkeleton />}>
        <GraficosGestaoSectionServer params={params} />
      </Suspense>
    </div>
  )
}
