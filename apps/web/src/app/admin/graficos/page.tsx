import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { createClient } from '@/lib/supabase/server'
import type {
  GestaoEvolucaoMes,
  GestaoSegmentoSummary,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'
import { buildGestaoLojasDisponiveis } from './gestao-filter-options'
import { GestaoFilters } from './components/gestao-filters'
import { OfficialUnitSummary } from './components/official-unit-summary'
import { SegmentoSection } from './components/segmento-section'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { IndicadoresSection } from '@/components/admin/indicadores/indicadores-section'
import type {
  KpisNotasOrdens,
  ResumoDiarioRow,
  LojaIndicadoresRow,
  ColaboradorIndicadoresRow,
} from '@/lib/types/indicadores'

export const dynamic = 'force-dynamic'

function resolvePeriodoIndicadores(params: Record<string, string | undefined>): {
  startDate: string
  endDate: string
  startIso: string
  endExclusiveIso: string
} {
  const now = new Date()
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0) // último dia do mês

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10)

  const startDate = params.start ?? toDateStr(defaultStart)
  const endDate = params.end ?? toDateStr(defaultEnd)

  // end param é inclusivo (YYYY-MM-DD); convertemos para exclusive adicionando 1 dia
  const endExclusive = new Date(endDate)
  endExclusive.setDate(endExclusive.getDate() + 1)

  return {
    startDate,
    endDate,
    startIso: `${startDate}T00:00:00+00:00`,
    endExclusiveIso: `${toDateStr(endExclusive)}T00:00:00+00:00`,
  }
}

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
  const nomeLoja = params.loja ?? undefined
  const textoBreve = params.servico ?? undefined

  const supabase = await createClient()

  // ── Indicadores ────────────────────────────────────────────────────────────
  const adminCtx = await getCurrentAdminContext()
  const { startDate, endDate, startIso, endExclusiveIso } = resolvePeriodoIndicadores(params)
  const adminScope = adminCtx.isGestor ? null : (adminCtx.adminId ?? null)

  const [kpisRes, resumoDiarioRes, lojasRes, colaboradoresRes] = await Promise.all([
    supabase.rpc('calcular_kpis_notas_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    supabase.rpc('calcular_resumo_diario_notas_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    supabase.rpc('calcular_indicadores_por_loja_notas', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    adminCtx.isGestor
      ? supabase.rpc('calcular_indicadores_por_colaborador', {
          p_start_iso: startIso,
          p_end_exclusive_iso: endExclusiveIso,
        })
      : Promise.resolve({ data: [], error: null }),
  ])

  const kpis = (kpisRes.data ?? {
    total_notas: 0,
    notas_convertidas: 0,
    taxa_conversao: 0,
    tempo_medio_nota_ordem: null,
    tempo_medio_conclusao: null,
    total_ordens_concluidas: 0,
  }) as KpisNotasOrdens
  const resumoDiario = (resumoDiarioRes.data ?? []) as ResumoDiarioRow[]
  const lojas = (lojasRes.data ?? []) as LojaIndicadoresRow[]
  const colaboradores = (colaboradoresRes.data ?? []) as ColaboradorIndicadoresRow[]
  // ── fim indicadores ────────────────────────────────────────────────────────

  const [
    topLojasRes,
    topServRes,
    evolucaoRes,
    segmentosRes,
    opcoesRes,
  ] = await Promise.all([
    supabase.rpc('calcular_gestao_top_lojas_por_status', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
      p_nome_loja: nomeLoja ?? null,
      p_texto_breve: textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_top_servicos', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
      p_nome_loja: nomeLoja ?? null,
      p_texto_breve: textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_evolucao_mensal', {
      p_ano: ano ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
      p_nome_loja: nomeLoja ?? null,
      p_texto_breve: textoBreve ?? null,
    }),
    supabase.rpc('calcular_gestao_resumo_segmentos', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
      p_nome_loja: nomeLoja ?? null,
      p_texto_breve: textoBreve ?? null,
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
  const anos = Array.from(new Set([currentYear, ...Array.from(anosSet)])).sort((a, b) => b - a)

  // Opções para os filtros de loja e serviço (derivadas dos dados já buscados, sem query extra)
  const lojasDisponiveis = buildGestaoLojasDisponiveis(topLojasRaw)

  const servicosDisponiveis = Array.from(
    new Set(
      topServRaw
        .map((r) => r.texto_breve)
        .filter((v): v is string => Boolean(v)),
    ),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <div className="space-y-8">
      <PageTitleBlock
        title="Graficos Gerenciais"
        subtitle="Padroes, recorrencia e ranking por unidade."
      />

      <IndicadoresSection
        isGestor={adminCtx.isGestor}
        startDate={startDate}
        endDate={endDate}
        kpis={kpis}
        resumoDiario={resumoDiario}
        lojas={lojas}
        colaboradores={colaboradores}
      />

      <section className="space-y-5 rounded-[28px] border border-border/60 bg-card/35 p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Analise gerencial
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Segmentos, recorrencia e ranking
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Combine ano, mes, tipo, loja e servico para localizar concentracao de volume,
              repeticao de demanda e peso de cada segmento na operacao.
            </p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground xl:max-w-xs xl:text-right">
            Os filtros abaixo controlam somente a leitura gerencial desta pagina.
          </p>
        </div>

        {segmentos.length > 0 && <OfficialUnitSummary segmentos={segmentos} />}

        <GestaoFilters
          tiposOrdem={tiposOrdem}
          anos={anos}
          anoAtivo={ano}
          mesAtivo={mes}
          tipoOrdemAtivo={tipoOrdem}
          lojas={lojasDisponiveis}
          lojaAtiva={nomeLoja}
          servicos={servicosDisponiveis}
          servicoAtivo={textoBreve}
        />
      </section>

      <ChartLabelsProvider>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Desdobramento por segmento</h2>
            <p className="text-sm text-muted-foreground">
              Cada bloco abaixo aprofunda lojas, servicos e evolucao mensal do recorte escolhido.
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
