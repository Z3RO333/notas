'use client'

import { useEffect, useMemo, useState } from 'react'
import { HardHat, Loader2, SlidersHorizontal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  NotesEmCampoEmptyState,
  NotesEmCampoHeroCard,
  NotesEmCampoOperationalPanel,
  NotesEmCampoSuggestionCard,
  type NotesEmCampoSuggestionCardViewModel,
} from '@/components/notas/notes-em-campo-dialog-blocks'
import {
  buildNotesEmCampoConsolidationMessage,
  buildNotesEmCampoData,
  inferNotesEmCampoService,
  pickNotesEmCampoSuggestionTarget,
} from '@/lib/notes/em-campo'
import {
  buscarSugestoesOperacionaisNotasEmCampo,
  listarOperacionaisCargaNotasEmCampo,
  listarServicosHistoricosNotasEmCampo,
  type OperacionalCargaRow,
  type OperacionalSuggestionRow,
  type ServicoHistoricoRow,
} from '@/lib/actions/notes-em-campo-actions'
import type {
  NotaPanelData,
  NotesEmCampoExternalMatchMode,
  NotesEmCampoOperationalSuggestion,
} from '@/lib/types/database'
import { cn } from '@/lib/utils'

interface NotesEmCampoDialogProps {
  getNotes: () => NotaPanelData[]
  unidadeOptions: Array<{ value: string; label: string }>
  defaultUnidade?: string
  className?: string
}

interface NoteScopeRow {
  nota: NotaPanelData
  loja: string | null
  servico: string | null
}

function toOperationalLoadSuggestion(row: OperacionalCargaRow): NotesEmCampoOperationalSuggestion {
  return {
    fornecedor_codigo: row.fornecedor_codigo,
    fornecedor_nome: row.fornecedor_nome,
    total_em_campo: row.total_em_campo,
    ordens_mesma_loja_ativas: row.ordens_mesma_loja_ativas,
    historico_loja_servico: 0,
    historico_servico_geral: 0,
    match_mode: null,
  }
}

function toOperationalSuggestion(row: OperacionalSuggestionRow): NotesEmCampoOperationalSuggestion {
  return {
    fornecedor_codigo: row.fornecedor_codigo,
    fornecedor_nome: row.fornecedor_nome,
    total_em_campo: row.total_em_campo,
    ordens_mesma_loja_ativas: row.ordens_mesma_loja_ativas,
    historico_loja_servico: row.historico_loja_servico,
    historico_servico_geral: row.historico_servico_geral,
    match_mode: row.match_mode as NotesEmCampoExternalMatchMode | null,
  }
}

function buildCorrelationKey(loja: string, servico: string): string {
  return `${loja}::${servico}`
}

function getNoteLojaLabel(
  nota: Pick<NotaPanelData, 'centro' | 'denominacao_unidade'>,
  unidadeLabelByValue: Map<string, string>,
): string | null {
  const denominacao = nota.denominacao_unidade?.trim()
  if (denominacao) return denominacao

  const centro = nota.centro?.trim()
  if (!centro) return null

  return unidadeLabelByValue.get(centro) ?? centro
}

function getNoteDateValue(nota: NotaPanelData): string {
  return nota.data_criacao_sap ?? nota.created_at
}

export function NotesEmCampoDialog({
  getNotes,
  unidadeOptions,
  defaultUnidade = '',
  className,
}: NotesEmCampoDialogProps) {
  const [open, setOpen] = useState(false)
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null)
  const [selectedUnidade, setSelectedUnidade] = useState(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
  const [selectedService, setSelectedService] = useState('')
  const [serviceOptions, setServiceOptions] = useState<Array<{ value: string; label: string }>>([])
  const [operationalLoadRows, setOperationalLoadRows] = useState<NotesEmCampoOperationalSuggestion[]>([])
  const [operationalSuggestions, setOperationalSuggestions] = useState<NotesEmCampoOperationalSuggestion[]>([])
  const [suggestionsByGroup, setSuggestionsByGroup] = useState<Record<string, NotesEmCampoOperationalSuggestion[]>>({})
  const [loadingServices, setLoadingServices] = useState(false)
  const [loadingLoads, setLoadingLoads] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [loadingNoteSuggestions, setLoadingNoteSuggestions] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const unidadeLabelByValue = useMemo(
    () => new Map(unidadeOptions.map((option) => [option.value, option.label])),
    [unidadeOptions]
  )

  const selectedLoja = selectedUnidade ? (unidadeLabelByValue.get(selectedUnidade) ?? '') : ''
  const isCorrelationReady = Boolean(selectedLoja && selectedService)
  const serviceCatalog = useMemo(
    () => serviceOptions.map((option) => option.value).filter(Boolean),
    [serviceOptions]
  )
  const notes = useMemo(
    () => (open ? getNotes() : []),
    [getNotes, open],
  )

  useEffect(() => {
    if (!open) {
      setExpandedSuggestionId(null)
      setSelectedUnidade(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
      setSelectedService('')
      setOperationalSuggestions([])
      setSuggestionsByGroup({})
      setErrorMessage(null)
    }
  }, [defaultUnidade, open])

  useEffect(() => {
    if (!open || serviceOptions.length > 0) return

    setLoadingServices(true)
    setErrorMessage(null)

    let cancelled = false

    void (async () => {
      try {
        const data = await listarServicosHistoricosNotasEmCampo()
        if (cancelled) return

        const rows = (data ?? []) as ServicoHistoricoRow[]
        setServiceOptions(rows.map((row) => ({ value: row.texto_breve, label: row.texto_breve })))
        setLoadingServices(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingServices(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar os servicos.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, serviceOptions.length])

  useEffect(() => {
    if (!open) return

    setLoadingLoads(true)
    setErrorMessage(null)

    let cancelled = false

    void (async () => {
      try {
        const data = await listarOperacionaisCargaNotasEmCampo(selectedLoja || null)
        if (cancelled) return

        setOperationalLoadRows(((data ?? []) as OperacionalCargaRow[]).map(toOperationalLoadSuggestion))
        setLoadingLoads(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingLoads(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar a carga dos operacionais.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, selectedLoja])

  useEffect(() => {
    if (isCorrelationReady) return
    setOperationalSuggestions([])
  }, [isCorrelationReady])

  useEffect(() => {
    if (!open || !isCorrelationReady) return

    setLoadingSuggestions(true)
    setErrorMessage(null)

    let cancelled = false

    void (async () => {
      try {
        const data = await buscarSugestoesOperacionaisNotasEmCampo(selectedLoja, selectedService)
        if (cancelled) return

        setOperationalSuggestions(((data ?? []) as OperacionalSuggestionRow[]).map(toOperationalSuggestion))
        setLoadingSuggestions(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingSuggestions(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel calcular as sugestoes de operacionais.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isCorrelationReady, open, selectedLoja, selectedService])

  const scopedNotes = useMemo<NoteScopeRow[]>(() => (
    notes
      .map((nota) => ({
        nota,
        loja: getNoteLojaLabel(nota, unidadeLabelByValue),
        servico: inferNotesEmCampoService(nota.descricao, serviceCatalog),
      }))
      .filter((item) => !selectedUnidade || item.nota.centro === selectedUnidade)
      .filter((item) => !selectedService || item.servico === selectedService)
      .sort((a, b) => {
        const dateCompare = getNoteDateValue(a.nota).localeCompare(getNoteDateValue(b.nota))
        if (dateCompare !== 0) return dateCompare
        return a.nota.numero_nota.localeCompare(b.nota.numero_nota, 'pt-BR')
      })
  ), [notes, selectedService, selectedUnidade, serviceCatalog, unidadeLabelByValue])

  useEffect(() => {
    if (!open || loadingServices) return

    const groups = Array.from(
      new Map(
        scopedNotes
          .filter((item) => item.loja && item.servico)
          .map((item) => {
            const loja = item.loja as string
            const servico = item.servico as string
            return [buildCorrelationKey(loja, servico), { loja, servico }] as const
          })
      ).values()
    )

    if (groups.length === 0) {
      setSuggestionsByGroup({})
      setLoadingNoteSuggestions(false)
      return
    }

    setLoadingNoteSuggestions(true)

    let cancelled = false

    void (async () => {
      try {
        const results = await Promise.all(groups.map(async (group) => {
          const data = await buscarSugestoesOperacionaisNotasEmCampo(group.loja, group.servico)

          return [
            buildCorrelationKey(group.loja, group.servico),
            ((data ?? []) as OperacionalSuggestionRow[]).map(toOperationalSuggestion),
          ] as const
        }))

        if (cancelled) return

        setSuggestionsByGroup(Object.fromEntries(results))
        setLoadingNoteSuggestions(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingNoteSuggestions(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel calcular as sugestoes por nota.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadingServices, open, scopedNotes])

  const visibleOperationalRows = isCorrelationReady ? operationalSuggestions : operationalLoadRows
  const data = useMemo(
    () => buildNotesEmCampoData({
      service: selectedService,
      operationals: visibleOperationalRows,
    }),
    [selectedService, visibleOperationalRows]
  )

  const noteSuggestions = useMemo<NotesEmCampoSuggestionCardViewModel[]>(() => (
    scopedNotes.map((item) => {
      const correlationKey = item.loja && item.servico
        ? buildCorrelationKey(item.loja, item.servico)
        : null
      const groupSuggestions = correlationKey ? suggestionsByGroup[correlationKey] ?? [] : []
      const target = pickNotesEmCampoSuggestionTarget({ suggestions: groupSuggestions })
      const primarySuggestion = target
        ? groupSuggestions.find((candidate) => candidate.fornecedor_codigo === target.codigo) ?? null
        : null

      return {
        notaId: item.nota.id,
        numeroNota: item.nota.numero_nota,
        loja: item.loja,
        servico: item.servico,
        destinoNome: target?.nome ?? null,
        destinoCodigo: target?.codigo ?? null,
        totalEmCampo: primarySuggestion?.total_em_campo ?? 0,
        ordensMesmaLojaAtivas: target?.ordens_mesma_loja_ativas ?? 0,
        historicoLojaServico: target?.historico_loja_servico ?? 0,
        historicoServicoGeral: target?.historico_servico_geral ?? 0,
        matchMode: target?.match_mode ?? null,
        mensagemConsolidacao: buildNotesEmCampoConsolidationMessage({
          loja: item.loja,
          target,
        }),
        alternativas: groupSuggestions.filter((candidate) => candidate.fornecedor_codigo !== target?.codigo),
      }
    })
  ), [scopedNotes, suggestionsByGroup])

  useEffect(() => {
    if (!noteSuggestions.some((item) => item.notaId === expandedSuggestionId)) {
      setExpandedSuggestionId(null)
    }
  }, [expandedSuggestionId, noteSuggestions])

  const notesWithSuggestion = noteSuggestions.filter((item) => item.destinoNome).length
  const notesSameStore = noteSuggestions.filter((item) => item.ordensMesmaLojaAtivas > 0).length
  const showLoadingIndicator = loadingServices || loadingLoads || loadingSuggestions || loadingNoteSuggestions

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn('w-full xl:w-auto', className)}>
          <HardHat className="mr-2 h-3.5 w-3.5" />
          Em Campo
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b bg-gradient-to-br from-primary/10 via-background to-background px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl">Em Campo no Painel de Notas</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6">
                Apoio rapido para distribuicao: veja o melhor encaixe por nota, identifique consolidacao por loja e use a carga atual dos operacionais como apoio.
              </DialogDescription>
            </div>
            {showLoadingIndicator && <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <NotesEmCampoHeroCard
              priority={data.hint.prioridade}
              hintMessage={data.hint.mensagem}
              loja={selectedLoja}
              servico={selectedService}
              totalNotas={noteSuggestions.length}
              notasComSugestao={notesWithSuggestion}
              notasMesmaLoja={notesSameStore}
            />

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="mb-4 flex items-center gap-2">
                  <div className="rounded-full border bg-muted/30 p-2">
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Refine o cenario</p>
                    <p className="text-xs text-muted-foreground">
                      Loja e servico ajudam o modal a priorizar consolidacao, historico e carga atual com mais precisao.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="notes-em-campo-loja">
                      Loja
                    </label>
                    <SearchableSelect
                      id="notes-em-campo-loja"
                      options={unidadeOptions}
                      value={selectedUnidade}
                      onValueChange={setSelectedUnidade}
                      placeholder="Escolha a loja"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="notes-em-campo-servico">
                      Servico
                    </label>
                    <SearchableSelect
                      id="notes-em-campo-servico"
                      options={serviceOptions}
                      value={selectedService}
                      onValueChange={setSelectedService}
                      placeholder={loadingServices ? 'Carregando servicos...' : 'Escolha o servico'}
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full md:w-auto"
                      onClick={() => {
                        setExpandedSuggestionId(null)
                        setSelectedUnidade(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
                        setSelectedService('')
                        setOperationalSuggestions([])
                        setSuggestionsByGroup({})
                        setErrorMessage(null)
                      }}
                    >
                      Limpar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {errorMessage && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </p>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
              <Card className="shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Sugestoes por nota</CardTitle>
                      <CardDescription>
                        A primeira dobra foca no que fazer agora: nota, servico e melhor operacional para encaminhar.
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold tracking-tight">{noteSuggestions.length}</p>
                      <p className="text-xs text-muted-foreground">nota{noteSuggestions.length !== 1 ? 's' : ''} no recorte</p>
                    </div>
                  </div>

                  {!isCorrelationReady && (
                    <p className="text-xs text-muted-foreground">
                      Mesmo sem selecionar um servico, o modal tenta identificar o melhor encaixe usando a descricao da nota e a loja.
                    </p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3">
                  {noteSuggestions.length === 0 && !loadingServices && !loadingNoteSuggestions ? (
                    <NotesEmCampoEmptyState>
                      Nenhuma nota visivel no recorte atual para sugerir. Ajuste a loja, o servico ou os filtros do painel.
                    </NotesEmCampoEmptyState>
                  ) : (
                    noteSuggestions.map((suggestion) => (
                      <NotesEmCampoSuggestionCard
                        key={suggestion.notaId}
                        suggestion={suggestion}
                        expanded={expandedSuggestionId === suggestion.notaId}
                        onToggle={() => setExpandedSuggestionId((current) => (
                          current === suggestion.notaId ? null : suggestion.notaId
                        ))}
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              <NotesEmCampoOperationalPanel
                title={isCorrelationReady ? 'Operacionais mais aderentes' : 'Carga atual dos operacionais'}
                description={
                  isCorrelationReady
                    ? 'A lista abaixo funciona como apoio: consolidacao na loja primeiro, depois aderencia do servico e menor carga em campo.'
                    : selectedLoja
                      ? 'Sem servico filtrado, a lateral destaca primeiro quem ja esta atuando nesta loja.'
                      : 'Use esta coluna para conferir quem esta mais leve antes de distribuir as notas.'
                }
                operationals={data.operacionais}
                emptyMessage={
                  isCorrelationReady
                    ? 'Nenhum operacional com historico suficiente para esta combinacao de loja e servico.'
                    : 'Nenhum operacional em campo no momento.'
                }
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
