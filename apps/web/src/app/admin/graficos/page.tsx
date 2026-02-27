import { createClient } from '@/lib/supabase/server'
import type {
  DashboardGestaoRow,
  GestaoEvolucaoMes,
  GestaoKpis,
  GestaoRecorrencia,
  GestaoTopLoja,
  GestaoTopServico,
} from '@/lib/types/database'
import { GestaoFilters } from './components/gestao-filters'
import { GestaoKpiStrip } from './components/gestao-kpi-strip'
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

interface GraficosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function GraficosPage({ searchParams }: GraficosPageProps) {
  const params = (await searchParams) ?? {}
  const ano = params.ano ? parseInt(params.ano) : undefined
  const mes = params.mes ? parseInt(params.mes) : undefined
  const tipoOrdem = params.tipo_ordem ?? undefined

  const supabase = await createClient()

  // Query base com filtros de ano/mês/tipo
  function applyFilters(query: ReturnType<typeof supabase.from>) {
    let q = query
    if (ano) q = (q as Parameters<typeof applyFilters>[0]).eq('ano', ano)
    if (mes) q = (q as Parameters<typeof applyFilters>[0]).eq('mes', mes)
    if (tipoOrdem) q = (q as Parameters<typeof applyFilters>[0]).eq('tipo_ordem', tipoOrdem)
    return q
  }

  // 5 queries paralelas
  const [
    topLojasRes,
    topServicosRes,
    recorrenciaRes,
    evolucaoRes,
    opcoesRes,
  ] = await Promise.all([
    // Q1 — Top 10 lojas por total_ordens
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('nome_loja, total_ordens')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
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
      return q.order('total_notas', { ascending: false }).limit(15)
    })(),

    // Q3 — Recorrência: loja × serviço top 30
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('nome_loja, texto_breve, total_notas')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('total_notas', { ascending: false }).limit(30)
    })(),

    // Q4 — Evolução mensal (todos os meses)
    (() => {
      let q = supabase
        .from('vw_dashboard_gestao_manutencao')
        .select('ano, mes, total_ordens, total_notas')
      if (ano) q = q.eq('ano', ano)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('ano').order('mes')
    })(),

    // Q5 — Opções de filtro (tipos de ordem e anos únicos)
    supabase
      .from('vw_dashboard_gestao_manutencao')
      .select('tipo_ordem, ano')
      .not('tipo_ordem', 'is', null),
  ])

  // --- Top Lojas: agregar (a view pode ter linhas por descricao, precisamos somar) ---
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

  // --- Recorrência: já ordenado, apenas tipar ---
  const recorrencia: GestaoRecorrencia[] = ((recorrenciaRes.data ?? []) as Pick<DashboardGestaoRow, 'nome_loja' | 'texto_breve' | 'total_notas'>[])
    .filter((r): r is GestaoRecorrencia => r.nome_loja != null)

  // --- Evolução mensal: agregar por ano+mes ---
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

  // --- KPIs totais ---
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gráficos – Inteligência Gerencial</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Padrões, recorrência e ranking de demanda por loja e tipo de serviço.
        </p>
      </div>

      <GestaoFilters
        tiposOrdem={tiposOrdem}
        anos={anos}
        anoAtivo={ano}
        mesAtivo={mes}
        tipoOrdemAtivo={tipoOrdem}
      />

      <GestaoKpiStrip kpis={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopLojasChart data={topLojas} />
        <TopServicosChart data={topServicos} />
      </div>

      <RecorrenciaTable data={recorrencia} />

      <EvolucaoMensalChart data={evolucao} />

      <FinanceiroBlock />
    </div>
  )
}
