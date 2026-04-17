import { Suspense } from 'react'
import { KpiStrip } from './kpi-strip'
import { IndicadoresScopeBadge } from './indicadores-scope-badge'
import { IndicadoresPeriodFilter } from './indicadores-period-filter'
import { ResumoDiarioChart } from './resumo-diario-chart'
import { LojaIndicadoresTable } from './loja-indicadores-table'
import { ColaboradorIndicadoresTable } from './colaborador-indicadores-table'
import type {
  KpisNotasOrdens,
  ResumoDiarioRow,
  LojaIndicadoresRow,
  ColaboradorIndicadoresRow,
} from '@/lib/types/indicadores'

interface IndicadoresSectionProps {
  isGestor: boolean
  startDate: string    // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD (último dia inclusivo)
  kpis: KpisNotasOrdens
  resumoDiario: ResumoDiarioRow[]
  lojas: LojaIndicadoresRow[]
  colaboradores: ColaboradorIndicadoresRow[]   // vazio para admin
}

export function IndicadoresSection({
  isGestor,
  startDate,
  endDate,
  kpis,
  resumoDiario,
  lojas,
  colaboradores,
}: IndicadoresSectionProps) {
  return (
    <div className="space-y-4">
      {/* Cabeçalho da seção com escopo e filtro */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Indicadores</h2>
          <IndicadoresScopeBadge isGestor={isGestor} />
        </div>
        <Suspense fallback={null}>
          <IndicadoresPeriodFilter startValue={startDate} endValue={endDate} />
        </Suspense>
      </div>

      {/* 6 mini KPIs */}
      <KpiStrip kpis={kpis} />

      {/* Gráfico de resumo diário */}
      <ResumoDiarioChart rows={resumoDiario} />

      {/* Detalhamentos: lojas + colaboradores */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LojaIndicadoresTable rows={lojas} />
        {isGestor && colaboradores.length > 0 && (
          <ColaboradorIndicadoresTable rows={colaboradores} />
        )}
      </div>
    </div>
  )
}
