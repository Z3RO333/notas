import { AlertTriangle, ShieldAlert, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PreventiveAnalysisResult } from '../preventive-analysis-utils'

type RiskLevel = PreventiveAnalysisResult['focusSummary']['selectedStoreRisk']

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: value >= 10 ? 0 : 1,
    minimumFractionDigits: value > 0 && value < 10 && value % 1 !== 0 ? 1 : 0,
  }).format(value)
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

function SummarySignalCard({
  title,
  tone,
  value,
  description,
}: {
  title: string
  tone: RiskLevel
  value: string
  description: string
}) {
  return (
    <div className={cn('rounded-2xl border p-4', toneClasses(tone))}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <p className={cn('mt-2 text-2xl font-semibold', toneText(tone))}>{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

interface PreventiveAnalysisSummaryViewProps {
  analysis: PreventiveAnalysisResult
}

export function PreventiveAnalysisSummaryView({
  analysis,
}: PreventiveAnalysisSummaryViewProps) {
  const focusAlert = analysis.alerts[0] ?? null
  const criticalAlerts = analysis.alerts.filter((alert) => alert.risk === 'critico').length
  const attentionAlerts = analysis.alerts.filter((alert) => alert.risk === 'atencao').length
  const focusTone: RiskLevel =
    analysis.storeRiskCounts.critico > 0
      ? 'critico'
      : analysis.storeRiskCounts.atencao > 0
        ? 'atencao'
        : 'saudavel'
  const queueTone: RiskLevel = criticalAlerts > 0 ? 'critico' : attentionAlerts > 0 ? 'atencao' : 'saudavel'

  return (
    <div className="space-y-5">
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-dashed">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" />
              Resumo do foco atual
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Aqui fica a leitura curta para decidir se a unidade precisa de ação agora ou apenas acompanhamento.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SummarySignalCard
              title="Unidade em foco"
              tone={focusTone}
              value={analysis.store ?? 'Rede completa'}
              description={
                analysis.store
                  ? `${analysis.storeRiskCounts.critico} riscos críticos e ${analysis.storeRiskCounts.atencao} pontos de atenção na unidade.`
                  : 'Selecione uma unidade para concentrar a leitura.'
              }
            />
            <SummarySignalCard
              title="Serviço em foco"
              tone={analysis.focusSummary.selectedStoreRisk}
              value={analysis.focusSummary.service ?? 'Escolha um serviço'}
              description={
                analysis.focusSummary.service
                  ? `${analysis.focusSummary.selectedStoreCount.toLocaleString('pt-BR')} ordem(ns) na unidade contra média de ${formatNumber(analysis.focusSummary.averagePerStore)}.`
                  : 'O radar pode sugerir automaticamente o serviço mais relevante.'
              }
            />
            <SummarySignalCard
              title="Fila preventiva"
              tone={queueTone}
              value={`${analysis.alerts.length.toLocaleString('pt-BR')} destaques`}
              description={`${criticalAlerts} críticos e ${attentionAlerts} atenção no recorte atual.`}
            />
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              Fila rapida de prioridade
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Mostra primeiro o que tende a virar dor operacional ou financeira se ficar represado.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis.alerts.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhum alerta preventivo relevante apareceu neste recorte.
              </div>
            ) : (
              analysis.alerts.slice(0, 5).map((alert) => (
                <div key={`${alert.store}-${alert.service}`} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{alert.store}</p>
                      <p className="text-sm text-muted-foreground">{alert.service}</p>
                    </div>
                    <Badge variant={badgeVariant(alert.risk)}>
                      {alert.risk === 'critico' ? 'Prioridade' : 'Acompanhar'}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border px-2.5 py-1">
                      Loja: {alert.count.toLocaleString('pt-BR')}
                    </span>
                    <span className="rounded-full border px-2.5 py-1">
                      Média: {formatNumber(alert.average)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{alert.message}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {focusAlert && (
        <div className="rounded-2xl border border-dashed bg-muted/15 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Primeiro desvio da fila</p>
              <p className="text-muted-foreground">
                {focusAlert.store} em {focusAlert.service}: {focusAlert.message}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
