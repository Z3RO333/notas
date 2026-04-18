import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { callGestaoBaseRpc } from '@/lib/graficos/gestao-base-rpc'
import { createClient } from '@/lib/supabase/server'
import type { GestaoBaseOrdem } from '@/lib/types/database'
import {
  buildPreventiveAnalysis,
  buildPreventiveRpcParams,
  resolvePreventivePeriod,
  type PreventiveAnalysisSearchParams,
} from './preventive-analysis-utils'
import { PreventiveAnalysisSection } from './components/preventive-analysis-section'

export const dynamic = 'force-dynamic'

type OpcoesRaw = {
  tipo_ordem: string | null
  ano: number | null
}

interface RadarPreventivoPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function RadarPreventivoPage({
  searchParams,
}: RadarPreventivoPageProps) {
  const params = ((await searchParams) ?? {}) as PreventiveAnalysisSearchParams
  const currentYear = new Date().getFullYear()
  const tipoOrdem = typeof params.tipo_ordem === 'string' ? params.tipo_ordem : 'PMOS'
  const period = resolvePreventivePeriod(params, new Date())
  const rpcParams = buildPreventiveRpcParams(period, tipoOrdem)

  const supabase = await createClient()

  const [opcoesRes, preventiveResults] = await Promise.all([
    supabase.rpc('listar_gestao_filtros'),
    Promise.all(rpcParams.map((rpcParam) => callGestaoBaseRpc(supabase, rpcParam))),
  ])

  if (opcoesRes.error) {
    throw opcoesRes.error
  }

  const preventiveError = preventiveResults.find((result) => result.error)?.error
  if (preventiveError) {
    throw preventiveError
  }

  const opcoesRaw = (opcoesRes.data ?? []) as OpcoesRaw[]
  const preventiveRaw = preventiveResults.flatMap((result) => (result.data ?? []) as GestaoBaseOrdem[])

  const tiposOrdemSet = new Set<string>()
  const anosSet = new Set<number>()
  for (const row of opcoesRaw) {
    if (row.tipo_ordem) tiposOrdemSet.add(row.tipo_ordem)
    if (row.ano) anosSet.add(row.ano)
  }

  const years = Array.from(new Set([currentYear, ...Array.from(anosSet)])).sort((a, b) => b - a)
  const orderTypeOptions = Array.from(tiposOrdemSet).sort()
  const analysis = buildPreventiveAnalysis(preventiveRaw, period, params, {
    useOfficialUnitBase: true,
  })

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Radar Preventivo"
        subtitle="Pintura, telhado, calha e infiltração por unidade."
      />

      <ChartLabelsProvider>
        <PreventiveAnalysisSection
          analysis={analysis}
          years={years}
          orderTypeOptions={orderTypeOptions}
          selectedOrderType={tipoOrdem}
        />
      </ChartLabelsProvider>
    </div>
  )
}
