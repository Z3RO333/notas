'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Filter,
  LayoutGrid,
  ShieldAlert,
  TableProperties,
  Target,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PreventiveAnalysisResult } from '../preventive-analysis-utils'
import { PreventiveAnalysisFilters } from './preventive-analysis-filters'
import { PreventiveAnalysisSummaryView } from './preventive-analysis-summary-view'

interface PreventiveAnalysisSectionProps {
  analysis: PreventiveAnalysisResult
  years: number[]
  orderTypeOptions: string[]
  selectedOrderType?: string
}

type RiskLevel = PreventiveAnalysisResult['focusSummary']['selectedStoreRisk']
type ViewMode = 'resumo' | 'detalhada'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: value >= 10 ? 0 : 1,
    minimumFractionDigits: value > 0 && value < 10 && value % 1 !== 0 ? 1 : 0,
  }).format(value)
}

function formatSigned(value: number): string {
  if (value === 0) return '0'
  const formatted = formatNumber(Math.abs(value))
  return value > 0 ? `+${formatted}` : `-${formatted}`
}

function badgeVariant(level: RiskLevel) {
  if (level === 'critico') return 'destructive' as const
  if (level === 'atencao') return 'secondary' as const
  return 'outline' as const
}

function toneClasses(level: RiskLevel) {
  if (level === 'critico') return 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20'
  if (level === 'atencao') return 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-border bg-card'
}

function toneText(level: RiskLevel) {
  if (level === 'critico') return 'text-red-700 dark:text-red-300'
  if (level === 'atencao') return 'text-amber-700 dark:text-amber-300'
  return 'text-emerald-700 dark:text-emerald-300'
}

function executiveSurface(level: RiskLevel) {
  if (level === 'critico') return 'border-red-200/80 bg-gradient-to-br from-red-50 via-background to-red-100/60 dark:border-red-900/60 dark:from-red-950/30 dark:via-background dark:to-red-950/10'
  if (level === 'atencao') return 'border-amber-200/80 bg-gradient-to-br from-amber-50 via-background to-amber-100/60 dark:border-amber-900/60 dark:from-amber-950/30 dark:via-background dark:to-amber-950/10'
  return 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-background to-emerald-100/50 dark:border-emerald-900/50 dark:from-emerald-950/20 dark:via-background dark:to-emerald-950/10'
}

function riskHeadline(level: RiskLevel) {
  if (level === 'critico') return 'Prioridade alta'
  if (level === 'atencao') return 'Ponto de atenção'
  return 'Leitura estável'
}

function resolveDominantRisk(analysis: PreventiveAnalysisResult): RiskLevel {
  if (
    analysis.focusSummary.selectedStoreRisk === 'critico'
    || analysis.alerts.some((alert) => alert.risk === 'critico')
  ) {
    return 'critico'
  }

  if (
    analysis.focusSummary.selectedStoreRisk === 'atencao'
    || analysis.alerts.length > 0
  ) {
    return 'atencao'
  }

  return 'saudavel'
}

function buildExecutiveSummary(analysis: PreventiveAnalysisResult, dominantRisk: RiskLevel) {
  const focusService = analysis.focusSummary.service
  const serviceLabel = focusService
    ? `${focusService}${analysis.focusSummary.autoSelected ? ' (sugerido)' : ''}`
    : 'Escolha um serviço'

  const coverageLabel = focusService
    ? `${analysis.focusSummary.storesWithOrders}/${analysis.totalStores} unidades abriram esse serviço`
    : `${analysis.totalServices} serviços monitorados no recorte`

  if (dominantRisk === 'critico' && analysis.store && focusService) {
    return {
      headline: `${analysis.store} merece revisão imediata em ${focusService}.`,
      action: `Priorize a validação de ${focusService} nessa unidade antes que a demanda vire uma ordem concentrada.`,
      reason: `${analysis.focusSummary.storesWithoutOrders} unidades ainda não abriram esse serviço no recorte. ${coverageLabel}.`,
      serviceLabel,
      coverageLabel,
    }
  }

  if (dominantRisk === 'atencao' && analysis.store && focusService) {
    return {
      headline: `${analysis.store} está abaixo do ritmo observado em ${focusService}.`,
      action: 'Vale confirmar se a demanda está represada ou se a unidade está operando fora do padrão da rede.',
      reason: `Média da rede: ${formatNumber(analysis.focusSummary.averagePerStore)} por unidade. ${coverageLabel}.`,
      serviceLabel,
      coverageLabel,
    }
  }

  return {
    headline: 'O recorte está organizado, mas continua valendo acompanhar ausências e baixa recorrência.',
    action: 'Use a unidade em foco para revisar pintura, telhado, calha e infiltracao antes do custo crescer.',
    reason: coverageLabel,
    serviceLabel,
    coverageLabel,
  }
}

function ExecutiveSpotlight({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-3 text-base font-semibold leading-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function PreventiveAnalysisSection({
  analysis,
  years,
  orderTypeOptions,
  selectedOrderType,
}: PreventiveAnalysisSectionProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('resumo')
  const dominantRisk = resolveDominantRisk(analysis)
  const summary = buildExecutiveSummary(analysis, dominantRisk)

  return (
    <section className="space-y-5">
      <Card className={cn('overflow-hidden', executiveSurface(dominantRisk))}>
        <CardContent className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariant(dominantRisk)}>{riskHeadline(dominantRisk)}</Badge>
              <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                {analysis.period.periodLabel}
              </span>
              <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                {analysis.unitTypeLabel}
              </span>
              {selectedOrderType && (
                <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                  {selectedOrderType}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Leitura executiva
              </p>
              <h3 className="text-2xl font-semibold tracking-tight">{summary.headline}</h3>
              <p className="max-w-3xl text-sm text-muted-foreground">{summary.action}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ExecutiveSpotlight
                icon={Building2}
                label="Unidade em foco"
                value={analysis.store ?? 'Rede completa'}
                hint={`${analysis.storeTotalOrders.toLocaleString('pt-BR')} ordens da unidade no recorte`}
              />
              <ExecutiveSpotlight
                icon={Wrench}
                label="Serviço em leitura"
                value={summary.serviceLabel}
                hint={`Média da rede: ${formatNumber(analysis.focusSummary.averagePerStore)}`}
              />
              <ExecutiveSpotlight
                icon={ShieldAlert}
                label="Cobertura do serviço"
                value={summary.coverageLabel}
                hint={`${analysis.focusSummary.storesWithoutOrders} unidades sem abertura no recorte`}
              />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                O que olhar agora
              </p>
              <p className="mt-3 text-sm font-medium">
                {dominantRisk === 'critico'
                  ? 'Comece pelos desvios sem abertura ou muito abaixo do padrão.'
                  : dominantRisk === 'atencao'
                    ? 'Use o comparativo para validar se a recorrência está abaixo do esperado.'
                    : 'A rede está estável; use o radar para checar serviços sensíveis com menor recorrência.'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{summary.reason}</p>
            </div>

            <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Como navegar nesta tela
              </p>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>1. Defina o recorte nos filtros.</p>
                <p>2. Escolha a unidade em foco para abrir o radar por serviço.</p>
                <p>3. Use o comparativo para ver se a loja está abaixo do ritmo da rede.</p>
                <p>4. Feche nos alertas para priorizar quem precisa de ação.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PreventiveAnalysisFilters
            years={years}
            periodPreset={analysis.period.preset}
            selectedYear={analysis.period.year}
            selectedMonth={analysis.period.month}
            selectedUnitType={analysis.unitType}
            selectedStore={analysis.store}
            selectedService={analysis.service}
            unitTypeOptions={analysis.options.unitTypes}
            storeOptions={analysis.options.stores}
            serviceOptions={analysis.options.services}
            orderTypeOptions={orderTypeOptions}
            selectedOrderType={selectedOrderType}
          />
        </CardContent>
      </Card>

      {analysis.totalOrders > 0 && (
        <Card>
          <CardHeader className="space-y-3 pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Modo de leitura</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Resumo para decisão rápida; detalhada para tabelas e comparativos.
                </p>
              </div>
              <div className="inline-flex rounded-xl border bg-muted/30 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === 'resumo' ? 'default' : 'ghost'}
                  className="rounded-lg"
                  onClick={() => setViewMode('resumo')}
                >
                  <LayoutGrid className="h-4 w-4" />
                  Resumo executivo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === 'detalhada' ? 'default' : 'ghost'}
                  className="rounded-lg"
                  onClick={() => setViewMode('detalhada')}
                >
                  <TableProperties className="h-4 w-4" />
                  Análise detalhada
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {analysis.totalOrders === 0 ? (
        <Card>
          <CardContent>
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium">Nenhuma ordem encontrada para esse recorte.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Ajuste período, tipo de unidade ou loja para abrir um recorte com histórico de manutenção.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'resumo' ? (
            <PreventiveAnalysisSummaryView analysis={analysis} />
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Target className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Leitura analitica</p>
                    <p className="text-sm text-muted-foreground">
                      Aqui entram as tabelas, comparativos e a fila completa para quem vai operar a análise.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {analysis.metricCards.map((card) => (
                    <div
                      key={card.label}
                      className={cn('rounded-2xl border p-4', toneClasses(card.tone))}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
                      <p className={cn('mt-2 text-2xl font-semibold', toneText(card.tone))}>{card.value}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{card.hint}</p>
                    </div>
                  ))}
                </div>
              </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Card className="border-dashed">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-4 w-4 text-sky-600" />
                      Unidade em foco
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {analysis.store
                        ? `${analysis.store} abriu ${analysis.storeTotalOrders.toLocaleString('pt-BR')} ordens no recorte.`
                        : 'Selecione uma unidade para abrir o radar por serviço.'}
                    </p>
                  </div>
                  <Badge variant={badgeVariant(analysis.storeRiskCounts.critico > 0 ? 'critico' : analysis.storeRiskCounts.atencao > 0 ? 'atencao' : 'saudavel')}>
                    {analysis.storeRiskCounts.critico > 0
                        ? `${analysis.storeRiskCounts.critico} críticos`
                        : analysis.storeRiskCounts.atencao > 0
                        ? `${analysis.storeRiskCounts.atencao} atenções`
                        : 'Sem alertas'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[460px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Serviço</th>
                        <th className="px-4 py-3 text-right font-medium">Loja</th>
                        <th className="px-4 py-3 text-right font-medium">Média</th>
                        <th className="px-4 py-3 text-right font-medium">Cobertura</th>
                        <th className="px-4 py-3 text-left font-medium">Sinal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.storeRows.map((row) => (
                        <tr key={row.service} className="border-b align-top last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.service}</p>
                            <p className="text-xs text-muted-foreground">{row.totalOrders.toLocaleString('pt-BR')} ordens na rede</p>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{row.count.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.average)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.coveragePct)}%</td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <Badge variant={badgeVariant(row.risk)}>
                                {row.risk === 'critico' ? 'Risco alto' : row.risk === 'atencao' ? 'Atenção' : 'Saudável'}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{row.message}</p>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Wrench className="h-4 w-4 text-emerald-600" />
                      Comparativo entre unidades
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {analysis.focusSummary.service
                        ? `${analysis.focusSummary.service} em ${analysis.focusSummary.storesWithOrders}/${analysis.totalStores} unidades.`
                        : 'Escolha um serviço para comparar o comportamento das unidades.'}
                    </p>
                  </div>
                  {analysis.focusSummary.service && (
                    <Badge variant={badgeVariant(analysis.focusSummary.selectedStoreRisk)}>
                      {analysis.focusSummary.autoSelected ? 'Serviço sugerido' : 'Serviço filtrado'}
                    </Badge>
                  )}
                </div>
                {analysis.focusSummary.service && (
                  <p className="text-xs text-muted-foreground">
                    Loja em foco: {analysis.focusSummary.selectedStoreCount.toLocaleString('pt-BR')} ordem(ns) versus média de {formatNumber(analysis.focusSummary.averagePerStore)} por unidade.
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[460px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Unidade</th>
                        <th className="px-4 py-3 text-right font-medium">Qtd</th>
                        <th className="px-4 py-3 text-right font-medium">Delta</th>
                        <th className="px-4 py-3 text-left font-medium">Sinal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.serviceRows.map((row) => (
                        <tr key={row.store} className="border-b align-top last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.store}</p>
                            <p className="text-xs text-muted-foreground">{row.totalOrders.toLocaleString('pt-BR')} ordens totais no recorte</p>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{row.count.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatSigned(row.deltaFromAverage)}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <Badge variant={badgeVariant(row.risk)}>
                                {row.risk === 'critico' ? 'Abaixo do padrão' : row.risk === 'atencao' ? 'Monitorar' : 'Dentro do padrão'}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{row.message}</p>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-dashed">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    Alertas preventivos do recorte
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    A fila abaixo combina ausência total e volume muito abaixo da média para priorizar quem precisa de ação primeiro.
                  </p>
                </div>
                <Badge variant={badgeVariant(analysis.alerts.some((alert) => alert.risk === 'critico') ? 'critico' : analysis.alerts.length > 0 ? 'atencao' : 'saudavel')}>
                  {analysis.alerts.length.toLocaleString('pt-BR')} destaques
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {analysis.alerts.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum alerta preventivo relevante apareceu no recorte selecionado.
                </div>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Unidade</th>
                        <th className="px-4 py-3 text-left font-medium">Serviço</th>
                        <th className="px-4 py-3 text-right font-medium">Qtd</th>
                        <th className="px-4 py-3 text-right font-medium">Média</th>
                        <th className="px-4 py-3 text-left font-medium">Leitura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.alerts.map((alert) => (
                        <tr key={`${alert.store}-${alert.service}`} className="border-b align-top last:border-0">
                          <td className="px-4 py-3 font-medium">{alert.store}</td>
                          <td className="px-4 py-3">{alert.service}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{alert.count.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(alert.average)}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <Badge variant={badgeVariant(alert.risk)}>
                                {alert.risk === 'critico' ? 'Prioridade' : 'Acompanhar'}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{alert.message}</p>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

              <div className="rounded-2xl border border-dashed bg-muted/15 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Leitura operacional do radar</p>
                    <p className="text-muted-foreground">
                      Ausência de abertura não significa erro automático. O objetivo aqui é separar o que precisa de resposta imediata do que pede apenas acompanhamento, para a demanda não estourar no fim do período.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
