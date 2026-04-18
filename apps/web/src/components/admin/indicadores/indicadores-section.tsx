import { Suspense } from 'react'
import { Activity, Building2, ClipboardCheck, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiStrip } from './kpi-strip'
import { IndicadoresScopeBadge } from './indicadores-scope-badge'
import { IndicadoresPeriodFilter } from './indicadores-period-filter'
import { ResumoDiarioChart } from './resumo-diario-chart'
import { LojaIndicadoresTable } from './loja-indicadores-table'
import { ColaboradorIndicadoresTable } from './colaborador-indicadores-table'
import { LojaOrdensIndicadoresTable } from './loja-ordens-indicadores-table'
import { ColaboradorOrdensIndicadoresTable } from './colaborador-ordens-indicadores-table'
import type {
  KpisNotasOrdens,
  ResumoDiarioRow,
  LojaIndicadoresRow,
  ColaboradorIndicadoresRow,
  LojaOrdensIndicadoresRow,
  ColaboradorOrdensIndicadoresRow,
} from '@/lib/types/indicadores'

interface IndicadoresSectionProps {
  isGestor: boolean
  startDate: string
  endDate: string
  kpis: KpisNotasOrdens
  resumoDiario: ResumoDiarioRow[]
  lojas: LojaIndicadoresRow[]
  colaboradores: ColaboradorIndicadoresRow[]
  lojasOrdens: LojaOrdensIndicadoresRow[]
  colaboradoresOrdens: ColaboradorOrdensIndicadoresRow[]
}

function formatShortDate(value: string): string {
  const [year = '', month = '', day = ''] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function IndicadoresSection({
  isGestor,
  startDate,
  endDate,
  kpis,
  resumoDiario,
  lojas,
  colaboradores,
  lojasOrdens,
  colaboradoresOrdens,
}: IndicadoresSectionProps) {
  const picoEntradas = resumoDiario.reduce<ResumoDiarioRow | null>((currentMax, row) => {
    if (!currentMax || row.notas_entradas > currentMax.notas_entradas) return row
    return currentMax
  }, null)

  const volumeMovimentado = resumoDiario.reduce((sum, row) => (
    sum + row.notas_entradas + row.viraram_ordem + row.ordens_concluidas
  ), 0)

  const monitoredPeople = isGestor ? colaboradores.length : 1
  const destaqueLoja = lojas[0]

  const quickReads = [
    {
      label: 'Dias monitorados',
      value: resumoDiario.length.toLocaleString('pt-BR'),
      helper: 'Série diária completa do período.',
      icon: Activity,
    },
    {
      label: 'Unidades com movimento',
      value: lojas.length.toLocaleString('pt-BR'),
      helper: destaqueLoja ? `Maior carteira: ${destaqueLoja.unidade}.` : 'Sem unidades no recorte.',
      icon: Building2,
    },
    {
      label: isGestor ? 'Colaboradores no ranking' : 'Pessoas monitoradas',
      value: monitoredPeople.toLocaleString('pt-BR'),
      helper: isGestor ? 'Equipe ordenada por notas recebidas.' : 'Leitura pessoal do período selecionado.',
      icon: Users,
    },
    {
      label: 'Pico de entradas',
      value: picoEntradas ? picoEntradas.notas_entradas.toLocaleString('pt-BR') : '0',
      helper: picoEntradas ? `Dia ${picoEntradas.data_ref.slice(8, 10)} concentrou o maior volume.` : 'Sem entradas no período.',
      icon: ClipboardCheck,
    },
  ]

  return (
    <section className="space-y-6 rounded-[28px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm sm:p-5 lg:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Indicadores
            </span>
            <IndicadoresScopeBadge isGestor={isGestor} />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Funil de notas, da conversão à conclusão
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Acompanhe entrada de notas, velocidade de conversão em ordem e conclusão do período
              selecionado antes de aprofundar os gráficos gerenciais por unidade.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
              Período: {formatShortDate(startDate)} a {formatShortDate(endDate)}
            </span>
            <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
              Volume movimentado: {volumeMovimentado.toLocaleString('pt-BR')}
            </span>
          </div>
        </div>

        <Suspense fallback={null}>
          <IndicadoresPeriodFilter startValue={startDate} endValue={endDate} />
        </Suspense>
      </div>

      <KpiStrip kpis={kpis} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <ResumoDiarioChart rows={resumoDiario} />

        <Card className="border-border/60 bg-background/75">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Leituras rápidas do período</CardTitle>
            <CardDescription>
              Contexto complementar para saber onde aprofundar a análise.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {quickReads.map((item) => {
              const Icon = item.icon

              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-border/60 bg-muted/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="text-2xl font-semibold tracking-tight tabular-nums">
                        {item.value}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 p-2 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.helper}
                  </p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Detalhamento por nota</h3>
          <p className="text-sm text-muted-foreground">
            Mostra carteira recebida e conversão em ordem, separados por unidade e por colaborador.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LojaIndicadoresTable rows={lojas} />
          {isGestor && <ColaboradorIndicadoresTable rows={colaboradores} />}
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Detalhamento por ordem concluída</h3>
          <p className="text-sm text-muted-foreground">
            Explicita volume concluído no período e o tempo médio de conclusão por unidade e por responsável.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LojaOrdensIndicadoresTable rows={lojasOrdens} />
          {isGestor && <ColaboradorOrdensIndicadoresTable rows={colaboradoresOrdens} />}
        </div>
      </div>
    </section>
  )
}
