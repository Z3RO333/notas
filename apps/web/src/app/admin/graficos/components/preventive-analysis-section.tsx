import { AlertTriangle, Building2, ShieldAlert, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PreventiveAnalysisResult } from '../graficos-preventiva-utils'
import { PreventiveAnalysisFilters } from './preventive-analysis-filters'

interface PreventiveAnalysisSectionProps {
  analysis: PreventiveAnalysisResult
  years: number[]
}

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

function badgeVariant(level: PreventiveAnalysisResult['focusSummary']['selectedStoreRisk']) {
  if (level === 'critico') return 'destructive' as const
  if (level === 'atencao') return 'secondary' as const
  return 'outline' as const
}

function toneClasses(level: PreventiveAnalysisResult['focusSummary']['selectedStoreRisk']) {
  if (level === 'critico') return 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20'
  if (level === 'atencao') return 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-border bg-card'
}

function toneText(level: PreventiveAnalysisResult['focusSummary']['selectedStoreRisk']) {
  if (level === 'critico') return 'text-red-700 dark:text-red-300'
  if (level === 'atencao') return 'text-amber-700 dark:text-amber-300'
  return 'text-emerald-700 dark:text-emerald-300'
}

export function PreventiveAnalysisSection({ analysis, years }: PreventiveAnalysisSectionProps) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Analise preventiva por loja e servico</h2>
        <p className="text-sm text-muted-foreground">
          Conte aberturas por categoria, destaque ausencias e compare unidades antes que a demanda vire uma ordem concentrada e cara.
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Radar preventivo</CardTitle>
              <p className="text-xs text-muted-foreground">
                Recorte atual: {analysis.period.periodLabel} - {analysis.unitTypeLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border px-2.5 py-1">{analysis.totalStores} unidades</span>
              <span className="rounded-full border px-2.5 py-1">{analysis.totalServices} servicos</span>
              <span className="rounded-full border px-2.5 py-1">{analysis.totalOrders.toLocaleString('pt-BR')} ordens</span>
            </div>
          </div>

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
          />
        </CardHeader>

        {analysis.totalOrders === 0 ? (
          <CardContent>
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <p className="text-sm font-medium">Nenhuma ordem encontrada para esse recorte.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Ajuste periodo, tipo de unidade ou loja para abrir um recorte com historico de manutencao.
              </p>
            </div>
          </CardContent>
        ) : (
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {analysis.metricCards.map((card) => (
                <div
                  key={card.label}
                  className={cn('rounded-xl border p-4', toneClasses(card.tone))}
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
                  <p className={cn('mt-2 text-2xl font-semibold', toneText(card.tone))}>{card.value}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{card.hint}</p>
                </div>
              ))}
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
                          : 'Selecione uma unidade para abrir o radar por servico.'}
                      </p>
                    </div>
                    <Badge variant={badgeVariant(analysis.storeRiskCounts.critico > 0 ? 'critico' : analysis.storeRiskCounts.atencao > 0 ? 'atencao' : 'saudavel')}>
                      {analysis.storeRiskCounts.critico > 0
                        ? `${analysis.storeRiskCounts.critico} criticos`
                        : analysis.storeRiskCounts.atencao > 0
                          ? `${analysis.storeRiskCounts.atencao} atencoes`
                          : 'Sem alertas'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[460px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                          <th className="px-4 py-3 text-left font-medium">Servico</th>
                          <th className="px-4 py-3 text-right font-medium">Loja</th>
                          <th className="px-4 py-3 text-right font-medium">Media</th>
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
                                  {row.risk === 'critico' ? 'Risco alto' : row.risk === 'atencao' ? 'Atencao' : 'Saudavel'}
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
                          : 'Escolha um servico para comparar o comportamento das unidades.'}
                      </p>
                    </div>
                    {analysis.focusSummary.service && (
                      <Badge variant={badgeVariant(analysis.focusSummary.selectedStoreRisk)}>
                        {analysis.focusSummary.autoSelected ? 'Servico sugerido' : 'Servico filtrado'}
                      </Badge>
                    )}
                  </div>
                  {analysis.focusSummary.service && (
                    <p className="text-xs text-muted-foreground">
                      Loja em foco: {analysis.focusSummary.selectedStoreCount.toLocaleString('pt-BR')} ordem(ns) versus media de {formatNumber(analysis.focusSummary.averagePerStore)} por unidade.
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
                                  {row.risk === 'critico' ? 'Abaixo do padrao' : row.risk === 'atencao' ? 'Monitorar' : 'Dentro do padrao'}
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
                      Combina ausencias totais e volumes muito abaixo da media para antecipar risco operacional e financeiro.
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
                          <th className="px-4 py-3 text-left font-medium">Servico</th>
                          <th className="px-4 py-3 text-right font-medium">Qtd</th>
                          <th className="px-4 py-3 text-right font-medium">Media</th>
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

            <div className="rounded-xl border border-dashed bg-muted/15 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Como ler esse radar</p>
                  <p className="text-muted-foreground">
                    Ausencia de abertura nao significa erro automatico, mas mostra onde pode existir manutencao represada.
                    Use a loja em foco para validar casos como pintura, civil, eletrica e refrigeracao antes que a demanda se concentre.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  )
}
