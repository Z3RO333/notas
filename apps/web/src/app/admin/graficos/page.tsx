import { createClient } from '@/lib/supabase/server'
import type {
  DashboardGestaoRow,
  GestaoEvolucaoMes,
  GestaoSegmentoSummary,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'
import { GestaoFilters } from './components/gestao-filters'
import { SegmentoSummary } from './components/segmento-summary'
import { SegmentoSection } from './components/segmento-section'
import { FinanceiroBlock } from './components/financeiro-block'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'

export const dynamic = 'force-dynamic'

const MES_LABELS: Record<number, string> = {
  1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
  7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez',
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

export default async function GraficosPage({ searchParams }: GraficosPageProps) {
  const params = (await searchParams) ?? {}
  const ano = params.ano ? parseInt(params.ano) : undefined
  const mes = params.mes ? parseInt(params.mes) : undefined
  const tipoOrdem = params.tipo_ordem ?? undefined

  const supabase = await createClient()

  // 4 queries paralelas — sem filtro de tipo_unidade, buscamos tudo e particionamos
  const [
    topLojasRes,
    topServicosRes,
    evolucaoRes,
    segmentosRes,
    opcoesRes,
  ] = await Promise.all([
    // Q1 — Top unidades com breakdown concluidas/em_aberto por status_ordem_raw
    supabase.rpc('calcular_gestao_top_lojas_por_status', {
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
    }),

    // Q2 — Top serviços por total_notas (todos os segmentos)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('texto_breve, tipo_unidade, total_notas')
        .not('tipo_unidade', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('total_notas', { ascending: false })
    })(),

    // Q3 — Evolução mensal (todos os segmentos)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('ano, mes, tipo_unidade, total_ordens, total_notas')
        .not('tipo_unidade', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('ano').order('mes')
    })(),

    // Q4 — total_notas por segmento (usado só para o card de resumo)
    // limit alto para evitar truncagem do PostgREST (default 1000 linhas)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('tipo_unidade, nome_loja, total_notas')
        .not('tipo_unidade', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.limit(10000)
    })(),

    // Q5 — Opções de filtro
    supabase
      .from('vw_dashboard_gestao_manutencao')
      .select('tipo_ordem, ano')
      .not('tipo_ordem', 'is', null),
  ])

  // --- Top Lojas por segmento (com breakdown concluidas/em_aberto) ---
  type TopLojasRaw = { nome_loja: string; tipo_unidade: string; concluidas: number; em_aberto: number; total_ordens: number }
  const topLojasRaw = (topLojasRes.data ?? []) as TopLojasRaw[]

  const topLojasBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const sorted: GestaoTopLoja[] = topLojasRaw
        .filter((row) => row.tipo_unidade === tipo && row.nome_loja)
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 10)
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoTopLoja[]>

  // --- Top Serviços por segmento ---
  type TopServRaw = Pick<DashboardGestaoRow, 'texto_breve' | 'tipo_unidade' | 'total_notas'>
  const topServicosRaw = (topServicosRes.data ?? []) as TopServRaw[]

  const topServBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const map = new Map<string, number>()
      for (const row of topServicosRaw) {
        if (row.tipo_unidade !== tipo) continue
        map.set(row.texto_breve, (map.get(row.texto_breve) ?? 0) + row.total_notas)
      }
      const total = Array.from(map.values()).reduce((a, b) => a + b, 0)
      const sorted: GestaoTopServico[] = Array.from(map.entries())
        .map(([texto_breve, total_notas]) => ({
          texto_breve,
          total_notas,
          percentual: total > 0 ? parseFloat(((total_notas / total) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.total_notas - a.total_notas)
        .slice(0, 15)
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoTopServico[]>

  // --- Evolução mensal por segmento ---
  type EvolucaoRaw = Pick<DashboardGestaoRow, 'ano' | 'mes' | 'tipo_unidade' | 'total_ordens' | 'total_notas'>
  const evolucaoRaw = (evolucaoRes.data ?? []) as EvolucaoRaw[]

  const evolucaoBySegmento = Object.fromEntries(
    TIPOS.map((tipo) => {
      const map = new Map<string, { ano: number; mes: number; total_ordens: number; total_notas: number }>()
      for (const row of evolucaoRaw) {
        if (row.tipo_unidade !== tipo) continue
        const key = `${row.ano}-${String(row.mes).padStart(2, '0')}`
        const existing = map.get(key)
        if (existing) {
          existing.total_ordens += row.total_ordens
          existing.total_notas += row.total_notas
        } else {
          map.set(key, { ano: row.ano, mes: row.mes, total_ordens: row.total_ordens, total_notas: row.total_notas })
        }
      }
      const sorted: GestaoEvolucaoMes[] = Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({
          ...v,
          label: `${MES_LABELS[v.mes] ?? v.mes}/${String(v.ano).slice(2)}`,
        }))
      return [tipo, sorted]
    })
  ) as Record<TipoUnidade, GestaoEvolucaoMes[]>

  // --- Segmentos: summary por LOJA / FARMA / CD ---
  // total_ordens e unidades vêm do Q1 RPC (sem risco de truncagem, 1 linha por unidade)
  // total_notas vem do Q4 view (com limit 10000)
  type SegRaw = Pick<DashboardGestaoRow, 'tipo_unidade' | 'nome_loja' | 'total_notas'>
  const segRaw = (segmentosRes.data ?? []) as SegRaw[]

  const segMap = new Map<TipoUnidade, { total_ordens: number; total_notas: number; unidades: number }>()

  // total_ordens e contagem de unidades — fonte: Q1 RPC (preciso)
  for (const row of topLojasRaw) {
    if (!row.tipo_unidade) continue
    const t = row.tipo_unidade as TipoUnidade
    if (!segMap.has(t)) segMap.set(t, { total_ordens: 0, total_notas: 0, unidades: 0 })
    const entry = segMap.get(t)!
    entry.total_ordens += row.total_ordens
    entry.unidades += 1
  }

  // total_notas — fonte: Q4 view
  const notasMap = new Map<TipoUnidade, number>()
  for (const row of segRaw) {
    if (!row.tipo_unidade) continue
    const t = row.tipo_unidade as TipoUnidade
    notasMap.set(t, (notasMap.get(t) ?? 0) + row.total_notas)
  }
  for (const [t, notas] of notasMap) {
    const entry = segMap.get(t)
    if (entry) entry.total_notas = notas
  }

  const grandTotalOrdens = Array.from(segMap.values()).reduce((s, e) => s + e.total_ordens, 0)
  const segmentos: GestaoSegmentoSummary[] = TIPOS
    .filter((t) => segMap.has(t))
    .map((tipo) => {
      const e = segMap.get(tipo)!
      return {
        tipo,
        label: TIPO_LABEL[tipo],
        total_ordens: e.total_ordens,
        total_notas: e.total_notas,
        unidades: e.unidades,
        percentual_ordens: grandTotalOrdens > 0
          ? parseFloat(((e.total_ordens / grandTotalOrdens) * 100).toFixed(1))
          : 0,
      }
    })

  // --- Opções de filtro ---
  const opcoesRaw = (opcoesRes.data ?? []) as Pick<DashboardGestaoRow, 'tipo_ordem' | 'ano'>[]
  const tiposOrdemSet = new Set<string>()
  const anosSet = new Set<number>()
  for (const row of opcoesRaw) {
    if (row.tipo_ordem) tiposOrdemSet.add(row.tipo_ordem)
    if (row.ano) anosSet.add(row.ano)
  }
  const tiposOrdem = Array.from(tiposOrdemSet).sort()
  const anos = Array.from(anosSet).sort((a, b) => b - a)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gráficos – Inteligência Gerencial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Padrões, recorrência e ranking por segmento de unidade.
        </p>
      </div>

      {/* Cards de resumo por segmento */}
      {segmentos.length > 0 && (
        <SegmentoSummary segmentos={segmentos} />
      )}

      {/* Filtros globais */}
      <GestaoFilters
        tiposOrdem={tiposOrdem}
        anos={anos}
        anoAtivo={ano}
        mesAtivo={mes}
        tipoOrdemAtivo={tipoOrdem}
      />

      {/* Seções separadas por segmento */}
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

      <FinanceiroBlock />
    </div>
  )
}
