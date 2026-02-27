import { createClient } from '@/lib/supabase/server'
import type {
  DashboardGestaoRow,
  GestaoEvolucaoMes,
  GestaoKpis,
  GestaoRecorrencia,
  GestaoSegmentoSummary,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'
import { GestaoFilters } from './components/gestao-filters'
import { GestaoKpiStrip } from './components/gestao-kpi-strip'
import { TipoUnidadeTabs } from './components/tipo-unidade-tabs'
import { SegmentoSummary } from './components/segmento-summary'
import { TopLojasChart } from './components/top-lojas-chart'
import { TopServicosChart } from './components/top-servicos-chart'
import { RecorrenciaTable } from './components/recorrencia-table'
import { EvolucaoMensalChart } from './components/evolucao-mensal-chart'
import { FinanceiroBlock } from './components/financeiro-block'

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

interface GraficosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function GraficosPage({ searchParams }: GraficosPageProps) {
  const params = (await searchParams) ?? {}
  const ano = params.ano ? parseInt(params.ano) : undefined
  const mes = params.mes ? parseInt(params.mes) : undefined
  const tipoOrdem = params.tipo_ordem ?? undefined
  const tipoParam = params.tipo?.toUpperCase() as TipoUnidade | undefined
  const tipoUnidade: TipoUnidade | undefined =
    tipoParam && ['LOJA', 'FARMA', 'CD'].includes(tipoParam) ? tipoParam : undefined

  const supabase = await createClient()

  // 6 queries paralelas
  const [
    topLojasRes,
    topServicosRes,
    recorrenciaRes,
    evolucaoRes,
    segmentosRes,
    opcoesRes,
  ] = await Promise.all([
    // Q1 — Top 10 unidades por total_ordens (dentro do segmento selecionado)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('nome_loja, total_ordens')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      if (tipoUnidade) q = q.eq('tipo_unidade', tipoUnidade)
      return q.order('total_ordens', { ascending: false }).limit(10)
    })(),

    // Q2 — Top 15 serviços por total_notas
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('texto_breve, total_notas')
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      if (tipoUnidade) q = q.eq('tipo_unidade', tipoUnidade)
      return q.order('total_notas', { ascending: false }).limit(15)
    })(),

    // Q3 — Recorrência: unidade × serviço top 30
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('nome_loja, texto_breve, total_notas')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      if (tipoUnidade) q = q.eq('tipo_unidade', tipoUnidade)
      return q.order('total_notas', { ascending: false }).limit(30)
    })(),

    // Q4 — Evolução mensal
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('ano, mes, total_ordens, total_notas')
      if (ano) q = q.eq('ano', ano)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      if (tipoUnidade) q = q.eq('tipo_unidade', tipoUnidade)
      return q.order('ano').order('mes')
    })(),

    // Q5 — Resumo por segmento (sempre sem filtro de tipo_unidade para mostrar todos)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('tipo_unidade, nome_loja, total_ordens, total_notas')
        .not('tipo_unidade', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q
    })(),

    // Q6 — Opções de filtro
    supabase
      .from('vw_dashboard_gestao_manutencao')
      .select('tipo_ordem, ano')
      .not('tipo_ordem', 'is', null),
  ])

  // --- Top Lojas: agregar por nome_loja ---
  const topLojasRaw = (topLojasRes.data ?? []) as Pick<DashboardGestaoRow, 'nome_loja' | 'total_ordens'>[]
  const topLojasMap = new Map<string, number>()
  for (const row of topLojasRaw) {
    if (!row.nome_loja) continue
    topLojasMap.set(row.nome_loja, (topLojasMap.get(row.nome_loja) ?? 0) + row.total_ordens)
  }
  const topLojas: GestaoTopLoja[] = Array.from(topLojasMap.entries())
    .map(([nome_loja, total_ordens]) => ({ nome_loja, total_ordens }))
    .sort((a, b) => b.total_ordens - a.total_ordens)
    .slice(0, 10)

  // --- Top Serviços: agregar por texto_breve ---
  const topServicosRaw = (topServicosRes.data ?? []) as Pick<DashboardGestaoRow, 'texto_breve' | 'total_notas'>[]
  const topServicosMap = new Map<string, number>()
  for (const row of topServicosRaw) {
    topServicosMap.set(row.texto_breve, (topServicosMap.get(row.texto_breve) ?? 0) + row.total_notas)
  }
  const totalNotasServicos = Array.from(topServicosMap.values()).reduce((a, b) => a + b, 0)
  const topServicos: GestaoTopServico[] = Array.from(topServicosMap.entries())
    .map(([texto_breve, total_notas]) => ({
      texto_breve,
      total_notas,
      percentual: totalNotasServicos > 0 ? parseFloat(((total_notas / totalNotasServicos) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total_notas - a.total_notas)
    .slice(0, 15)

  // --- Recorrência ---
  const recorrencia: GestaoRecorrencia[] = (
    (recorrenciaRes.data ?? []) as Pick<DashboardGestaoRow, 'nome_loja' | 'texto_breve' | 'total_notas'>[]
  ).filter((r): r is GestaoRecorrencia => r.nome_loja != null)

  // --- Evolução mensal ---
  const evolucaoRaw = (evolucaoRes.data ?? []) as Pick<DashboardGestaoRow, 'ano' | 'mes' | 'total_ordens' | 'total_notas'>[]
  const evolucaoMap = new Map<string, { ano: number; mes: number; total_ordens: number; total_notas: number }>()
  for (const row of evolucaoRaw) {
    const key = `${row.ano}-${String(row.mes).padStart(2, '0')}`
    const existing = evolucaoMap.get(key)
    if (existing) {
      existing.total_ordens += row.total_ordens
      existing.total_notas += row.total_notas
    } else {
      evolucaoMap.set(key, { ano: row.ano, mes: row.mes, total_ordens: row.total_ordens, total_notas: row.total_notas })
    }
  }
  const evolucao: GestaoEvolucaoMes[] = Array.from(evolucaoMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      ...v,
      label: `${MES_LABELS[v.mes] ?? v.mes}/${String(v.ano).slice(2)}`,
    }))

  // --- Segmentos: summary por LOJA / FARMA / CD ---
  type SegRaw = Pick<DashboardGestaoRow, 'tipo_unidade' | 'nome_loja' | 'total_ordens' | 'total_notas'>
  const segRaw = (segmentosRes.data ?? []) as SegRaw[]
  const segMap = new Map<TipoUnidade, { total_ordens: number; total_notas: number; unidades: Set<string> }>()
  let grandTotalOrdens = 0
  for (const row of segRaw) {
    if (!row.tipo_unidade) continue
    const t = row.tipo_unidade as TipoUnidade
    if (!segMap.has(t)) segMap.set(t, { total_ordens: 0, total_notas: 0, unidades: new Set() })
    const entry = segMap.get(t)!
    entry.total_ordens += row.total_ordens
    entry.total_notas += row.total_notas
    if (row.nome_loja) entry.unidades.add(row.nome_loja)
    grandTotalOrdens += row.total_ordens
  }
  const segmentos: GestaoSegmentoSummary[] = (['LOJA', 'FARMA', 'CD'] as TipoUnidade[])
    .filter((t) => segMap.has(t))
    .map((tipo) => {
      const e = segMap.get(tipo)!
      return {
        tipo,
        label: TIPO_LABEL[tipo],
        total_ordens: e.total_ordens,
        total_notas: e.total_notas,
        unidades: e.unidades.size,
        percentual_ordens: grandTotalOrdens > 0
          ? parseFloat(((e.total_ordens / grandTotalOrdens) * 100).toFixed(1))
          : 0,
      }
    })

  // --- KPIs do segmento ativo ---
  const kpis: GestaoKpis = {
    total_ordens: topLojas.reduce((acc, l) => acc + l.total_ordens, 0),
    total_notas: topServicos.reduce((acc, s) => acc + s.total_notas, 0),
    lojas_ativas: topLojasMap.size,
    servicos_unicos: topServicosMap.size,
  }

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

  const tabLabel = tipoUnidade ? TIPO_LABEL[tipoUnidade] : 'Todos os segmentos'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gráficos – Inteligência Gerencial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Padrões, recorrência e ranking por segmento de unidade.
        </p>
      </div>

      {/* Tabs de segmento */}
      <TipoUnidadeTabs segmentos={segmentos} tipoAtivo={params.tipo} />

      {/* Cards de resumo por segmento (só quando aba TODOS) */}
      {!tipoUnidade && segmentos.length > 0 && (
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

      {/* KPIs do segmento ativo */}
      <div>
        {tipoUnidade && (
          <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest font-medium">
            {tabLabel}
          </p>
        )}
        <GestaoKpiStrip kpis={kpis} tipoUnidade={tipoUnidade} />
      </div>

      {/* Gráficos principais */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TopLojasChart data={topLojas} tipoUnidade={tipoUnidade} />
        <TopServicosChart data={topServicos} />
      </div>

      <RecorrenciaTable data={recorrencia} tipoUnidade={tipoUnidade} />

      <EvolucaoMensalChart data={evolucao} />

      <FinanceiroBlock />
    </div>
  )
}
