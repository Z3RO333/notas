import { createClient } from '@/lib/supabase/server'
import type {
  GestaoEvolucaoMes,
  GestaoTopLoja,
  GestaoTopServico,
} from '@/lib/types/database'
import { GestaoFilters } from '../graficos/components/gestao-filters'
import { TopLojasChart } from '../graficos/components/top-lojas-chart'
import { TopServicosChart } from '../graficos/components/top-servicos-chart'
import { EvolucaoMensalChart } from '../graficos/components/evolucao-mensal-chart'
import { ChartLabelsProvider } from '@/components/charts/chart-labels-context'
import { ChartLabelsToggle } from '@/components/charts/chart-labels-toggle'
import { Zap, Thermometer } from 'lucide-react'

export const dynamic = 'force-dynamic'

const MES_LABELS: Record<number, string> = {
  1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
  7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez',
}

const CATEGORIAS = ['elevadores', 'refrigeracao'] as const
type Categoria = typeof CATEGORIAS[number]

const CATEGORIA_CONFIG: Record<Categoria, { label: string; sublabel: string; cor: string; Icon: typeof Zap }> = {
  elevadores: {
    label: 'Críticos',
    sublabel: 'Elevadores, geradores e subestações',
    cor: '#7c3aed',
    Icon: Zap,
  },
  refrigeracao: {
    label: 'Refrigeração',
    sublabel: 'Todas as ordens',
    cor: '#0891b2',
    Icon: Thermometer,
  },
}

interface EquipamentosPageProps {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function EquipamentosPage({ searchParams }: EquipamentosPageProps) {
  const params = (await searchParams) ?? {}
  const currentYear = new Date().getFullYear()
  const parsedAno = params.ano && params.ano !== 'todos' ? parseInt(params.ano, 10) : NaN
  const parsedMes = params.mes && params.mes !== 'todos' ? parseInt(params.mes, 10) : NaN
  const ano = params.ano === 'todos'
    ? undefined
    : (Number.isFinite(parsedAno) ? parsedAno : currentYear)
  const mes = Number.isFinite(parsedMes) ? parsedMes : undefined
  const tipoOrdem = params.tipo_ordem ?? undefined

  const supabase = await createClient()

  const [
    topElevRes,
    topRefriRes,
    viewElevRes,
    viewRefriRes,
    anosRes,
  ] = await Promise.all([
    // Q1 — Top unidades elevadores
    supabase.rpc('calcular_equipamentos_top_lojas', {
      p_categoria: 'elevadores',
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
    }),

    // Q2 — Top unidades refrigeração
    supabase.rpc('calcular_equipamentos_top_lojas', {
      p_categoria: 'refrigeracao',
      p_ano: ano ?? null,
      p_mes: mes ?? null,
      p_tipo_ordem: tipoOrdem ?? null,
    }),

    // Q3 — Serviços + evolução elevadores
    (() => {
      let q = supabase
        .from('vw_equipamentos_criticos')
        .select('texto_breve, nome_loja, ano, mes, total_ordens, total_notas')
        .eq('categoria', 'elevadores')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('total_ordens', { ascending: false }).limit(5000)
    })(),

    // Q4 — Serviços + evolução refrigeração
    (() => {
      let q = supabase
        .from('vw_equipamentos_criticos')
        .select('texto_breve, nome_loja, ano, mes, total_ordens, total_notas')
        .eq('categoria', 'refrigeracao')
        .not('nome_loja', 'is', null)
      if (ano) q = q.eq('ano', ano)
      if (mes) q = q.eq('mes', mes)
      if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
      return q.order('total_ordens', { ascending: false }).limit(5000)
    })(),

    // Q5 — Anos disponíveis
    supabase
      .from('vw_equipamentos_criticos')
      .select('ano')
      .not('ano', 'is', null),
  ])

  type TopLojasRaw = { nome_loja: string; tipo_unidade: string; concluidas: number; em_aberto: number; total_ordens: number }
  type ViewRow = { texto_breve: string; nome_loja: string; ano: number; mes: number; total_ordens: number; total_notas: number }

  const rawByCategoria: Record<Categoria, { topLojas: GestaoTopLoja[]; viewRows: ViewRow[] }> = {
    elevadores: {
      topLojas: ((topElevRes.data ?? []) as TopLojasRaw[])
        .filter((r) => r.nome_loja)
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 10) as GestaoTopLoja[],
      viewRows: (viewElevRes.data ?? []) as ViewRow[],
    },
    refrigeracao: {
      topLojas: ((topRefriRes.data ?? []) as TopLojasRaw[])
        .filter((r) => r.nome_loja)
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 10) as GestaoTopLoja[],
      viewRows: (viewRefriRes.data ?? []) as ViewRow[],
    },
  }

  // --- Top Serviços por categoria ---
  const topServByCategoria = Object.fromEntries(
    CATEGORIAS.map((cat) => {
      const rows = rawByCategoria[cat].viewRows
      const map = new Map<string, number>()
      for (const row of rows) {
        map.set(row.texto_breve, (map.get(row.texto_breve) ?? 0) + row.total_ordens)
      }
      const total = Array.from(map.values()).reduce((a, b) => a + b, 0)
      const sorted: GestaoTopServico[] = Array.from(map.entries())
        .map(([texto_breve, total_ordens]) => ({
          texto_breve,
          total_ordens,
          percentual: total > 0 ? parseFloat(((total_ordens / total) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.total_ordens - a.total_ordens)
        .slice(0, 15)
      return [cat, sorted]
    })
  ) as Record<Categoria, GestaoTopServico[]>

  // --- Evolução mensal por categoria ---
  const evolucaoByCategoria = Object.fromEntries(
    CATEGORIAS.map((cat) => {
      const rows = rawByCategoria[cat].viewRows
      const map = new Map<string, { ano: number; mes: number; total_ordens: number; total_notas: number }>()
      for (const row of rows) {
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
      return [cat, sorted]
    })
  ) as Record<Categoria, GestaoEvolucaoMes[]>

  // --- Anos disponíveis ---
  const anosSet = new Set<number>()
  for (const row of (anosRes.data ?? []) as { ano: number }[]) {
    if (row.ano) anosSet.add(row.ano)
  }
  const anos = Array.from(new Set([currentYear, ...Array.from(anosSet)])).sort((a, b) => b - a)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipamentos Críticos e Refrigeração</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitoramento de elevadores, geradores e refrigeração por unidade.
        </p>
      </div>

      <GestaoFilters
        tiposOrdem={['PMOS', 'PMPL']}
        anos={anos}
        anoAtivo={ano}
        mesAtivo={mes}
        tipoOrdemAtivo={tipoOrdem}
      />

      <ChartLabelsProvider>
        <div className="flex justify-end">
          <ChartLabelsToggle />
        </div>
        <div className="space-y-10">
          {CATEGORIAS.map((cat) => {
            const { label, sublabel, cor, Icon } = CATEGORIA_CONFIG[cat]
            return (
              <div key={cat} className="space-y-4">
                {/* Header da seção */}
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 shrink-0" style={{ color: cor }} />
                  <h2 className="text-base font-semibold" style={{ color: cor }}>{label}</h2>
                  <span className="text-xs text-muted-foreground">({sublabel})</span>
                  <div className="flex-1 h-px opacity-30" style={{ backgroundColor: cor }} />
                </div>

                {/* Top Unidades + Top Serviços */}
                <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <TopLojasChart
                    data={rawByCategoria[cat].topLojas}
                    ano={ano}
                    mes={mes}
                    categoria={cat}
                  />
                  <TopServicosChart data={topServByCategoria[cat] ?? []} />
                </div>

                {/* Evolução mensal */}
                <EvolucaoMensalChart data={evolucaoByCategoria[cat] ?? []} />
              </div>
            )
          })}
        </div>
      </ChartLabelsProvider>
    </div>
  )
}
