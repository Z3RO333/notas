import { createClient } from '@/lib/supabase/server'
import type {
  GestaoBaseOrdem,
  GestaoEvolucaoMes,
  GestaoSegmentoSummary,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'
import { GestaoFilters } from './components/gestao-filters'
import { OfficialUnitSummary } from './components/official-unit-summary'
import { PreventiveAnalysisSection } from './components/preventive-analysis-section'
import { SegmentoSection } from './components/segmento-section'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { callGestaoBaseRpc } from '@/lib/graficos/gestao-base-rpc'
import {
  buildPreventiveAnalysis,
  buildPreventiveRpcParams,
  resolvePreventivePeriod,
} from './graficos-preventiva-utils'

export const dynamic = 'force-dynamic'

const MES_LABELS: Record<number, string> = {
  1: 'Jan',
  2: 'Fev',
  3: 'Mar',
  4: 'Abr',
  5: 'Mai',
  6: 'Jun',
  7: 'Jul',
  8: 'Ago',
  9: 'Set',
  10: 'Out',
  11: 'Nov',
  12: 'Dez',
}

const TIPO_LABEL: Record<TipoUnidade, string> = {
  LOJA: 'Lojas',
  FARMA: 'Farmas',
  CD: 'CDs',
}

const TIPOS: TipoUnidade[] = ['LOJA', 'FARMA', 'CD']

interface GraficosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

type TopLojasRaw = {
  nome_loja: string
  tipo_unidade: string
  concluidas: number
  em_aberto: number
  total_ordens: number
}

type TopServRaw = Pick<GestaoTopServico, 'texto_breve' | 'total_ordens'> & {
  tipo_unidade: string | null
}

type EvolucaoRaw = Pick<GestaoEvolucaoMes, 'ano' | 'mes' | 'total_ordens' | 'total_notas'> & {
  tipo_unidade: string | null
}

type SegRaw = Pick<GestaoSegmentoSummary, 'total_ordens' | 'total_notas' | 'unidades'> & {
  tipo_unidade: string | null
}

type OpcoesRaw = {
  tipo_ordem: string | null
  ano: number | null
}

export default async function GraficosPage({ searchParams }: GraficosPageProps) {
  const params = (await searchParams) ?? {}
  const currentYear = new Date().getFullYear()
  const parsedAno = params.ano && params.ano !== 'todos' ? parseInt(params.ano, 10) : NaN
  const parsedMes = params.mes && params.mes !== 'todos' ? parseInt(params.mes, 10) : NaN
  const ano =
    params.ano === 'todos'
      ? undefined
      : Number.isFinite(parsedAno)
        ? parsedAno
        : currentYear
  const mes = Number.isFinite(parsedMes) ? parsedMes : undefined
  const tipoOrdem = params.tipo_ordem ?? undefined
  const preventivePeriod = resolvePreventivePeriod(params, new Date())
  const preventiveRpcParams = buildPreventiveRpcParams(preventivePeriod, tipoOrdem)

  const supabase = await createClient()

  const [mainResults, preventiveResults] = await Promise.all([
    Promise.all([
      supabase.rpc('calcular_gestao_top_lojas_por_status', {
        p_ano: ano ?? null,
        p_mes: mes ?? null,
        p_tipo_ordem: tipoOrdem ?? null,
      }),
      supabase.rpc('calcular_gestao_top_servicos', {
        p_ano: ano ?? null,
        p_mes: mes ?? null,
        p_tipo_ordem: tipoOrdem ?? null,
      }),
      supabase.rpc('calcular_gestao_evolucao_mensal', {
        p_ano: ano ?? null,
        p_tipo_ordem: tipoOrdem ?? null,
      }),
      supabase.rpc('calcular_gestao_resumo_segmentos', {
        p_ano: ano ?? null,
        p_mes: mes ?? null,
        p_tipo_ordem: tipoOrdem ?? null,
      }),
      supabase.rpc('listar_gestao_filtros'),
    ]),
    Promise.all(preventiveRpcParams.map((rpcParams) => callGestaoBaseRpc(supabase, rpcParams))),
  ])

  const [topLojasRes, topServRes, evolucaoRes, segmentosRes, opcoesRes] = mainResults
  const mainError = [
    topLojasRes.error,
    topServRes.error,
    evolucaoRes.error,
    segmentosRes.error,
    opcoesRes.error,
  ].find(Boolean)
  const preventiveError = preventiveResults.find((result) => result.error)?.error

  if (mainError) {
    throw mainError
  }

  const topLojasRaw = (topLojasRes.data ?? []) as TopLojasRaw[]
  const topServRaw = (topServRes.data ?? []) as TopServRaw[]
  const evolucaoRaw = (evolucaoRes.data ?? []) as EvolucaoRaw[]
  const segRaw = (segmentosRes.data ?? []) as SegRaw[]
  const opcoesRaw = (opcoesRes.data ?? []) as OpcoesRaw[]
  const preventiveRaw = preventiveError
    ? []
    : preventiveResults.flatMap((result) => (result.data ?? []) as GestaoBaseOrdem[])

  const topLojasBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const sorted: GestaoTopLoja[] = topLojasRaw
        .filter((row) => row.tipo_unidade === tipo && row.nome_loja)
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 10)
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoTopLoja[]>

  const topServBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const rows = topServRaw
        .filter((row) => row.tipo_unidade === tipo)
        .sort((a, b) => b.total_ordens - a.total_ordens || a.texto_breve.localeCompare(b.texto_breve, 'pt-BR'))
      const total = rows.reduce((sum, row) => sum + row.total_ordens, 0)
      const sorted: GestaoTopServico[] = rows
        .slice(0, 15)
        .map((row) => ({
          texto_breve: row.texto_breve,
          total_ordens: row.total_ordens,
          percentual: total > 0 ? parseFloat(((row.total_ordens / total) * 100).toFixed(1)) : 0,
        }))
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoTopServico[]>

  const evolucaoBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const sorted: GestaoEvolucaoMes[] = evolucaoRaw
        .filter((row) => row.tipo_unidade === tipo)
        .sort((a, b) => {
          if (a.ano !== b.ano) return a.ano - b.ano
          return a.mes - b.mes
        })
        .map((row) => ({
          ano: row.ano,
          mes: row.mes,
          total_ordens: row.total_ordens,
          total_notas: row.total_notas,
          label: `${MES_LABELS[row.mes] ?? row.mes}/${String(row.ano).slice(2)}`,
        }))
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoEvolucaoMes[]>

  const grandTotalOrdens = segRaw.reduce((sum, row) => sum + row.total_ordens, 0)
  const segmentos: GestaoSegmentoSummary[] = TIPOS.flatMap((tipo) => {
    const row = segRaw.find((item) => item.tipo_unidade === tipo)
    if (!row) return []

    return [
      {
        tipo,
        label: TIPO_LABEL[tipo],
        total_ordens: row.total_ordens,
        total_notas: row.total_notas,
        unidades: row.unidades,
        percentual_ordens:
          grandTotalOrdens > 0
            ? parseFloat(((row.total_ordens / grandTotalOrdens) * 100).toFixed(1))
            : 0,
      },
    ]
  })

  const tiposOrdemSet = new Set<string>()
  const anosSet = new Set<number>()
  for (const row of opcoesRaw) {
    if (row.tipo_ordem) tiposOrdemSet.add(row.tipo_ordem)
    if (row.ano) anosSet.add(row.ano)
  }
  const tiposOrdem = Array.from(tiposOrdemSet).sort()
  const anos = Array.from(new Set([currentYear, ...Array.from(anosSet)])).sort((a, b) => b - a)
  const preventiveAnalysis = preventiveError
    ? null
    : buildPreventiveAnalysis(preventiveRaw, preventivePeriod, params, { useOfficialUnitBase: true })

  if (preventiveError) {
    console.warn('Analise preventiva dos graficos indisponivel. Mantendo painel principal carregado.', preventiveError)
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Gráficos - Inteligência Gerencial"
        subtitle="Padrões, recorrência e ranking por segmento de unidade."
      />

      {segmentos.length > 0 && <OfficialUnitSummary segmentos={segmentos} />}

      <GestaoFilters
        tiposOrdem={tiposOrdem}
        anos={anos}
        anoAtivo={ano}
        mesAtivo={mes}
        tipoOrdemAtivo={tipoOrdem}
      />

      {preventiveAnalysis ? (
        <PreventiveAnalysisSection analysis={preventiveAnalysis} years={anos} />
      ) : (
        <div className="rounded-xl border border-dashed bg-muted/10 px-4 py-5 text-sm text-muted-foreground">
          A analise preventiva ficou temporariamente indisponivel neste ambiente, mas os graficos principais continuam carregando normalmente.
        </div>
      )}

      <ChartLabelsProvider>
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>
        <div className="space-y-10">
          {TIPOS.map((tipo) => (
            <SegmentoSection
              key={tipo}
              tipo={tipo}
              topLojas={topLojasBySegmento[tipo] ?? []}
              topServicos={topServBySegmento[tipo] ?? []}
              evolucao={evolucaoBySegmento[tipo] ?? []}
              ano={ano}
              mes={mes}
              tipoOrdem={tipoOrdem}
            />
          ))}
        </div>
      </ChartLabelsProvider>
    </div>
  )
}
