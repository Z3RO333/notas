import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import { createClient } from '@/lib/supabase/server'
import { buildGestaoLojasDisponiveis } from '../gestao-filter-options'
import { GestaoFilters } from './gestao-filters'
import { OfficialUnitSummary } from './official-unit-summary'
import { SegmentoSection } from './segmento-section'
import {
  MES_LABELS,
  OpcoesRaw,
  resolveGraficosFilters,
  SegRaw,
  TIPO_LABEL,
  TIPOS,
  TopLojasRaw,
  TopServRaw,
  type EvolucaoRaw,
} from '../graficos-page-shared'
import type {
  GestaoEvolucaoMes,
  GestaoSegmentoSummary,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'

interface GraficosGestaoSectionServerProps {
  params: Record<string, string | undefined>
}

export async function GraficosGestaoSectionServer({
  params,
}: GraficosGestaoSectionServerProps) {
  const filters = resolveGraficosFilters(params)
  const supabase = await createClient()

  const [
    topLojasRes,
    topServRes,
    evolucaoRes,
    segmentosRes,
    opcoesRes,
  ] = await Promise.all([
    supabase.rpc('calcular_gestao_top_lojas_por_status', {
      p_ano: filters.ano ?? null,
      p_mes: filters.mes ?? null,
      p_tipo_ordem: filters.tipoOrdem ?? null,
      p_nome_loja: filters.nomeLoja ?? null,
      p_texto_breve: filters.textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_top_servicos', {
      p_ano: filters.ano ?? null,
      p_mes: filters.mes ?? null,
      p_tipo_ordem: filters.tipoOrdem ?? null,
      p_nome_loja: filters.nomeLoja ?? null,
      p_texto_breve: filters.textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_evolucao_mensal', {
      p_ano: filters.ano ?? null,
      p_tipo_ordem: filters.tipoOrdem ?? null,
      p_nome_loja: filters.nomeLoja ?? null,
      p_texto_breve: filters.textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_resumo_segmentos', {
      p_ano: filters.ano ?? null,
      p_mes: filters.mes ?? null,
      p_tipo_ordem: filters.tipoOrdem ?? null,
      p_nome_loja: filters.nomeLoja ?? null,
      p_texto_breve: filters.textoBreve ?? null,
    }),
    supabase.rpc('listar_gestao_filtros'),
  ])

  const mainError = [
    topLojasRes.error,
    topServRes.error,
    evolucaoRes.error,
    segmentosRes.error,
    opcoesRes.error,
  ].find(Boolean)

  if (mainError) {
    throw mainError
  }

  const topLojasRaw = (topLojasRes.data ?? []) as TopLojasRaw[]
  const topServRaw = (topServRes.data ?? []) as TopServRaw[]
  const evolucaoRaw = (evolucaoRes.data ?? []) as EvolucaoRaw[]
  const segRaw = (segmentosRes.data ?? []) as SegRaw[]
  const opcoesRaw = (opcoesRes.data ?? []) as OpcoesRaw[]

  const topLojasBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const sorted: GestaoTopLoja[] = topLojasRaw
        .filter((row) => row.tipo_unidade === tipo && row.nome_loja)
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 10)
      return [tipo, sorted]
    }),
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
    }),
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
    }),
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
  const anos = Array.from(new Set([filters.currentYear, ...Array.from(anosSet)])).sort((a, b) => b - a)
  const lojasDisponiveis = buildGestaoLojasDisponiveis(topLojasRaw)
  const servicosDisponiveis = Array.from(
    new Set(
      topServRaw
        .map((row) => row.texto_breve)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <>
      <section className="space-y-5 rounded-[28px] border border-border/60 bg-card/35 p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Análise gerencial
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Segmentos, recorrência e ranking
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Combine ano, mês, tipo, loja e serviço para localizar concentração de volume,
              repetição de demanda e peso de cada segmento na operação.
            </p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground xl:max-w-xs xl:text-right">
            Os filtros abaixo controlam somente a leitura gerencial desta página.
          </p>
        </div>

        {segmentos.length > 0 && <OfficialUnitSummary segmentos={segmentos} />}

        <GestaoFilters
          tiposOrdem={tiposOrdem}
          anos={anos}
          anoAtivo={filters.ano}
          mesAtivo={filters.mes}
          tipoOrdemAtivo={filters.tipoOrdem}
          lojas={lojasDisponiveis}
          lojaAtiva={filters.nomeLoja}
          servicos={servicosDisponiveis}
          servicoAtivo={filters.textoBreve}
        />
      </section>

      <ChartLabelsProvider>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Desdobramento por segmento</h2>
            <p className="text-sm text-muted-foreground">
              Cada bloco abaixo aprofunda lojas, serviços e variação mensal do recorte escolhido.
            </p>
          </div>
          <div className="flex justify-end">
            <ChartLabelsToggle />
          </div>
        </div>
        <div className="space-y-10">
          {TIPOS.map((tipo) => (
            <SegmentoSection
              key={tipo}
              tipo={tipo}
              topLojas={topLojasBySegmento[tipo] ?? []}
              topServicos={topServBySegmento[tipo] ?? []}
              evolucao={evolucaoBySegmento[tipo] ?? []}
              ano={filters.ano}
              mes={filters.mes}
              tipoOrdem={filters.tipoOrdem}
            />
          ))}
        </div>
      </ChartLabelsProvider>
    </>
  )
}
