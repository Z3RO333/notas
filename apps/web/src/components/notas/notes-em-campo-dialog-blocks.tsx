'use client'

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Compass,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  NotesEmCampoExternalMatchMode,
  NotesEmCampoHintPriority,
  NotesEmCampoOperationalSuggestion,
} from '@/lib/types/database'
import { cn } from '@/lib/utils'

export interface NotesEmCampoSuggestionCardViewModel {
  notaId: string
  numeroNota: string
  loja: string | null
  servico: string | null
  destinoNome: string | null
  destinoCodigo: string | null
  totalEmCampo: number
  ordensMesmaLojaAtivas: number
  historicoLojaServico: number
  historicoServicoGeral: number
  matchMode: NotesEmCampoExternalMatchMode | null
  mensagemConsolidacao: string | null
  alternativas: NotesEmCampoOperationalSuggestion[]
}

function getPriorityCardClasses(priority: NotesEmCampoHintPriority): string {
  switch (priority) {
    case 'interno':
      return 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-background to-background'
    case 'externo':
      return 'border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-background to-background'
    case 'equilibrado':
    default:
      return 'border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-background to-background'
  }
}

function getPriorityBadgeClasses(priority: NotesEmCampoHintPriority): string {
  switch (priority) {
    case 'interno':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'externo':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'equilibrado':
    default:
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
}

function getPriorityLabel(priority: NotesEmCampoHintPriority): string {
  switch (priority) {
    case 'interno':
      return 'operacional'
    case 'externo':
      return 'fornecedor'
    case 'equilibrado':
    default:
      return 'equilibrado'
  }
}

function getMatchModeLabel(value: NotesEmCampoExternalMatchMode): string {
  return value === 'exato' ? 'Loja + servico' : 'Servico geral'
}

function getSuggestionToneClasses(suggestion: NotesEmCampoSuggestionCardViewModel): string {
  if (suggestion.ordensMesmaLojaAtivas > 0) {
    return 'border-orange-500/30 bg-orange-500/8'
  }

  if (suggestion.matchMode === 'exato') {
    return 'border-emerald-500/25 bg-emerald-500/6'
  }

  if (suggestion.matchMode === 'fallback_servico') {
    return 'border-slate-500/20 bg-slate-500/5'
  }

  return 'border-border bg-card'
}

function getSuggestionReasonLabel(suggestion: NotesEmCampoSuggestionCardViewModel): string {
  if (suggestion.ordensMesmaLojaAtivas > 0) return 'Mesma loja'
  if (suggestion.matchMode === 'exato') return 'Loja + servico'
  if (suggestion.matchMode === 'fallback_servico') return 'Servico geral'
  return 'Sem sugestao'
}

function getSuggestionReasonClasses(suggestion: NotesEmCampoSuggestionCardViewModel): string {
  if (suggestion.ordensMesmaLojaAtivas > 0) {
    return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300'
  }

  if (suggestion.matchMode === 'exato') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (suggestion.matchMode === 'fallback_servico') {
    return 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300'
  }

  return 'border-border bg-muted text-muted-foreground'
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/80 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}

export function NotesEmCampoEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export function NotesEmCampoHeroCard(props: {
  priority: NotesEmCampoHintPriority
  hintMessage: string
  loja: string
  servico: string
  totalNotas: number
  notasComSugestao: number
  notasMesmaLoja: number
}) {
  const metrics = [
    { label: 'Notas no recorte', value: String(props.totalNotas) },
    { label: 'Com encaixe direto', value: String(props.notasComSugestao) },
    { label: 'Consolidando loja', value: String(props.notasMesmaLoja) },
  ]

  return (
    <Card className={cn('overflow-hidden shadow-sm', getPriorityCardClasses(props.priority))}>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('text-[11px] uppercase tracking-wide', getPriorityBadgeClasses(props.priority))}>
                <Sparkles className="mr-1 h-3 w-3" />
                Prioridade: {getPriorityLabel(props.priority)}
              </Badge>
              {props.loja && (
                <Badge variant="outline" className="text-[11px]">
                  <MapPin className="mr-1 h-3 w-3" />
                  {props.loja}
                </Badge>
              )}
              {props.servico && (
                <Badge variant="outline" className="text-[11px]">
                  <Compass className="mr-1 h-3 w-3" />
                  {props.servico}
                </Badge>
              )}
            </div>

            <div className="space-y-1">
              <CardTitle className="text-xl">Assistente tatico de distribuicao</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                {props.hintMessage}
              </CardDescription>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[360px]">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border bg-background/80 px-4 py-3 shadow-sm">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{metric.value}</p>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

export function NotesEmCampoSuggestionCard(props: {
  suggestion: NotesEmCampoSuggestionCardViewModel
  expanded: boolean
  onToggle: () => void
}) {
  const { suggestion } = props
  const hasDetails = suggestion.alternativas.length > 0 || suggestion.destinoNome !== null

  return (
    <Card className={cn('transition-colors', getSuggestionToneClasses(suggestion))} data-testid={`notes-em-campo-suggestion-${suggestion.numeroNota}`}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px] tracking-wide">
                {suggestion.numeroNota}
              </Badge>
              <Badge variant="outline" className={cn('text-[11px]', getSuggestionReasonClasses(suggestion))}>
                {getSuggestionReasonLabel(suggestion)}
              </Badge>
              {suggestion.loja && (
                <Badge variant="outline" className="text-[11px]">
                  <MapPin className="mr-1 h-3 w-3" />
                  {suggestion.loja}
                </Badge>
              )}
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Servico identificado</p>
                <p className="text-base font-semibold leading-snug">
                  {suggestion.servico ?? 'Servico nao identificado'}
                </p>
              </div>

              <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" />

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Melhor encaixe agora</p>
                <p className="text-base font-semibold leading-snug">
                  {suggestion.destinoNome ?? 'Sem sugestao'}
                </p>
                {suggestion.destinoCodigo && (
                  <p className="text-xs text-muted-foreground">Cod. {suggestion.destinoCodigo}</p>
                )}
              </div>
            </div>
          </div>

          {hasDetails && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={props.onToggle}>
              {props.expanded ? 'Recolher detalhes' : 'Ver detalhes'}
              {props.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <MetricPill
            label="Mesma loja"
            value={suggestion.ordensMesmaLojaAtivas > 0 ? `${suggestion.ordensMesmaLojaAtivas} ativa(s)` : 'Sem carga ativa'}
          />
          <MetricPill label="Loja + servico" value={String(suggestion.historicoLojaServico)} />
          <MetricPill label="Servico geral" value={String(suggestion.historicoServicoGeral)} />
          <MetricPill label="Em campo agora" value={String(suggestion.totalEmCampo)} />
        </div>

        {suggestion.mensagemConsolidacao && (
          <div className="rounded-xl border border-orange-500/25 bg-orange-500/10 px-4 py-3 text-sm text-orange-800 dark:text-orange-200">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{suggestion.mensagemConsolidacao}</p>
            </div>
          </div>
        )}

        {props.expanded && (
          <div className="space-y-3 rounded-xl border bg-background/80 p-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold">Mais contexto para decidir</p>
              <p className="text-xs text-muted-foreground">
                As alternativas abaixo seguem a mesma logica de consolidacao por loja, aderencia por servico e menor carga em campo.
              </p>
            </div>

            {suggestion.alternativas.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Outras opcoes para esta nota
                </p>
                {suggestion.alternativas.map((alternative) => (
                  <div
                    key={`${suggestion.notaId}-${alternative.fornecedor_codigo}`}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/10 px-3 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{alternative.fornecedor_nome}</p>
                      <p className="text-xs text-muted-foreground">Cod. {alternative.fornecedor_codigo}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {alternative.ordens_mesma_loja_ativas > 0 && (
                        <Badge variant="outline" className="border-orange-500/30 text-orange-700 dark:text-orange-300">
                          {alternative.ordens_mesma_loja_ativas} na mesma loja
                        </Badge>
                      )}
                      {alternative.historico_loja_servico > 0 && (
                        <Badge variant="outline">{alternative.historico_loja_servico} loja + servico</Badge>
                      )}
                      {alternative.historico_servico_geral > 0 && (
                        <Badge variant="outline">{alternative.historico_servico_geral} servico geral</Badge>
                      )}
                      <Badge variant="secondary">{alternative.total_em_campo} em campo</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <NotesEmCampoEmptyState>
                Nenhuma alternativa adicional encontrada para esta nota no recorte atual.
              </NotesEmCampoEmptyState>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function NotesEmCampoOperationalPanel(props: {
  title: string
  description: string
  operationals: NotesEmCampoOperationalSuggestion[]
  emptyMessage: string
}) {
  return (
    <Card className="h-full shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.operationals.length === 0 ? (
          <NotesEmCampoEmptyState>{props.emptyMessage}</NotesEmCampoEmptyState>
        ) : (
          <div className="space-y-2">
            {props.operationals.map((operational) => (
              <div
                key={operational.fornecedor_codigo}
                className={cn(
                  'rounded-xl border px-3 py-3 transition-colors',
                  operational.ordens_mesma_loja_ativas > 0 ? 'border-orange-500/25 bg-orange-500/5' : 'bg-muted/5'
                )}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{operational.fornecedor_nome}</p>
                      <p className="text-xs text-muted-foreground">Cod. {operational.fornecedor_codigo}</p>
                    </div>
                    <Badge variant="secondary">{operational.total_em_campo} em campo</Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {operational.ordens_mesma_loja_ativas > 0 && (
                      <Badge variant="outline" className="border-orange-500/30 text-orange-700 dark:text-orange-300">
                        {operational.ordens_mesma_loja_ativas} nessa loja
                      </Badge>
                    )}
                    {operational.historico_loja_servico > 0 && (
                      <Badge variant="outline">{operational.historico_loja_servico} loja + servico</Badge>
                    )}
                    {operational.historico_servico_geral > 0 && (
                      <Badge variant="outline">{operational.historico_servico_geral} servico geral</Badge>
                    )}
                    {operational.match_mode && (
                      <Badge variant="outline">{getMatchModeLabel(operational.match_mode)}</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
