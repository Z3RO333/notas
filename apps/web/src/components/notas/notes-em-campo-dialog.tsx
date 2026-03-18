'use client'

import { useEffect, useMemo, useState } from 'react'
import { HardHat, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { resolveCargoLabelFromEspecialidade } from '@/lib/collaborator/cargo-presentation'
import {
  buildNotesEmCampoData,
  inferNotesEmCampoService,
  pickNotesEmCampoSuggestionTarget,
} from '@/lib/notes/em-campo'
import { createClient } from '@/lib/supabase/client'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type {
  NotaPanelData,
  NotesEmCampoExternalSuggestion,
  NotesEmCampoExternalMatchMode,
  NotesEmCampoNoteSuggestion,
} from '@/lib/types/database'
import { cn } from '@/lib/utils'

interface NotesEmCampoDialogProps {
  collaborators: CollaboratorData[]
  notes: NotaPanelData[]
  unidadeOptions: Array<{ value: string; label: string }>
  defaultUnidade?: string
  className?: string
}

interface OperacionalEmCampoRow {
  fornecedor_codigo: string
  fornecedor_nome: string
  total_em_campo: number
}

interface ServicoHistoricoRow {
  texto_breve: string
  total_ordens: number
}

interface ExternoSuggestionRow {
  fornecedor_codigo: string
  fornecedor_nome: string
  total_em_campo: number
  historico_loja_servico: number
  historico_servico_geral: number
  match_mode: NotesEmCampoExternalMatchMode
}

interface NoteScopeRow {
  nota: NotaPanelData
  loja: string | null
  servico: string | null
}

const LOAD_ONLY_MATCH_MODE: NotesEmCampoExternalMatchMode = 'fallback_servico'

function toLoadOnlySuggestion(row: OperacionalEmCampoRow): NotesEmCampoExternalSuggestion {
  return {
    fornecedor_codigo: row.fornecedor_codigo,
    fornecedor_nome: row.fornecedor_nome,
    total_em_campo: row.total_em_campo,
    historico_loja_servico: 0,
    historico_servico_geral: 0,
    match_mode: LOAD_ONLY_MATCH_MODE,
  }
}

function getPriorityStyles(priority: 'interno' | 'externo' | 'equilibrado'): string {
  switch (priority) {
    case 'interno':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900'
    case 'externo':
      return 'border-sky-200 bg-sky-50 text-sky-900'
    case 'equilibrado':
    default:
      return 'border-amber-200 bg-amber-50 text-amber-900'
  }
}

function getMatchModeLabel(value: NotesEmCampoExternalMatchMode): string {
  return value === 'exato' ? 'Loja + servico' : 'Servico geral'
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
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
  collaborators,
  notes,
  unidadeOptions,
  defaultUnidade = '',
  className,
}: NotesEmCampoDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [selectedUnidade, setSelectedUnidade] = useState(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
  const [selectedService, setSelectedService] = useState('')
  const [serviceOptions, setServiceOptions] = useState<Array<{ value: string; label: string }>>([])
  const [externalCurrentLoad, setExternalCurrentLoad] = useState<NotesEmCampoExternalSuggestion[]>([])
  const [externalSuggestions, setExternalSuggestions] = useState<NotesEmCampoExternalSuggestion[]>([])
  const [suggestionsByGroup, setSuggestionsByGroup] = useState<Record<string, NotesEmCampoExternalSuggestion[]>>({})
  const [loadingBase, setLoadingBase] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [loadingNoteSuggestions, setLoadingNoteSuggestions] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSelectedUnidade(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
      setSelectedService('')
      setExternalSuggestions([])
      setSuggestionsByGroup({})
      setErrorMessage(null)
      return
    }

    if (serviceOptions.length > 0 && externalCurrentLoad.length > 0) return

    setLoadingBase(true)
    setErrorMessage(null)

    let cancelled = false

    void (async () => {
      try {
        const [currentLoadResult, servicesResult] = await Promise.all([
          supabase.rpc('buscar_operacionais_em_campo'),
          supabase.rpc('listar_servicos_historicos_notas_em_campo', { p_limit: 250 }),
        ])

        if (currentLoadResult.error) throw currentLoadResult.error
        if (servicesResult.error) throw servicesResult.error
        if (cancelled) return

        const currentLoadRows = ((currentLoadResult.data ?? []) as OperacionalEmCampoRow[]).map(toLoadOnlySuggestion)
        const serviceRows = (servicesResult.data ?? []) as ServicoHistoricoRow[]

        setExternalCurrentLoad(currentLoadRows)
        setServiceOptions(serviceRows.map((row) => ({ value: row.texto_breve, label: row.texto_breve })))
        setLoadingBase(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingBase(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar os dados de apoio.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [defaultUnidade, externalCurrentLoad.length, open, serviceOptions.length, supabase])

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

  useEffect(() => {
    if (isCorrelationReady) return
    setExternalSuggestions([])
  }, [isCorrelationReady])

  useEffect(() => {
    if (!open || !isCorrelationReady) return

    setLoadingSuggestions(true)
    setErrorMessage(null)

    let cancelled = false

    void (async () => {
      try {
        const { data, error } = await supabase.rpc('buscar_sugestoes_operacionais_externos_notas_em_campo', {
          p_nome_loja: selectedLoja,
          p_texto_breve: selectedService,
        })

        if (error) throw error
        if (cancelled) return

        setExternalSuggestions(((data ?? []) as ExternoSuggestionRow[]).map((row) => ({
          fornecedor_codigo: row.fornecedor_codigo,
          fornecedor_nome: row.fornecedor_nome,
          total_em_campo: row.total_em_campo,
          historico_loja_servico: row.historico_loja_servico,
          historico_servico_geral: row.historico_servico_geral,
          match_mode: row.match_mode,
        })))
        setLoadingSuggestions(false)
      } catch (error: unknown) {
        if (cancelled) return
        setLoadingSuggestions(false)
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel calcular as sugestoes de externos.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isCorrelationReady, open, selectedLoja, selectedService, supabase])

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
    if (!open || loadingBase) return

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
          const { data, error } = await supabase.rpc('buscar_sugestoes_operacionais_externos_notas_em_campo', {
            p_nome_loja: group.loja,
            p_texto_breve: group.servico,
          })

          if (error) throw error

          return [
            buildCorrelationKey(group.loja, group.servico),
            ((data ?? []) as ExternoSuggestionRow[]).map((row) => ({
              fornecedor_codigo: row.fornecedor_codigo,
              fornecedor_nome: row.fornecedor_nome,
              total_em_campo: row.total_em_campo,
              historico_loja_servico: row.historico_loja_servico,
              historico_servico_geral: row.historico_servico_geral,
              match_mode: row.match_mode,
            })),
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
  }, [loadingBase, open, scopedNotes, supabase])

  const data = useMemo(
    () => buildNotesEmCampoData({
      collaborators,
      service: selectedService,
      externals: externalSuggestions,
    }),
    [collaborators, externalSuggestions, selectedService]
  )

  const noteSuggestions = useMemo<NotesEmCampoNoteSuggestion[]>(() => (
    scopedNotes.map((item) => {
      const correlationKey = item.loja && item.servico
        ? buildCorrelationKey(item.loja, item.servico)
        : null
      const target = pickNotesEmCampoSuggestionTarget({
        collaborators,
        service: item.servico,
        externals: correlationKey ? suggestionsByGroup[correlationKey] ?? [] : [],
      })

      return {
        nota_id: item.nota.id,
        numero_nota: item.nota.numero_nota,
        loja: item.loja,
        servico: item.servico,
        destino_tipo: target?.tipo ?? null,
        destino_codigo: target?.codigo ?? null,
        destino_nome: target?.nome ?? null,
        historico_loja_servico: target?.historico_loja_servico ?? 0,
        historico_servico_geral: target?.historico_servico_geral ?? 0,
        match_mode: target?.match_mode ?? null,
      }
    })
  ), [collaborators, scopedNotes, suggestionsByGroup])

  const visibleExternalRows = isCorrelationReady ? data.externos : externalCurrentLoad

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn('w-full xl:w-auto', className)}>
          <HardHat className="mr-2 h-3.5 w-3.5" />
          Em Campo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Em Campo no Painel de Notas</DialogTitle>
          <DialogDescription>
            Apoio rapido para distribuicao: veja a carga atual dos internos, os externos com melhor aderencia e o encaixe sugerido por nota.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={cn('rounded-lg border px-4 py-3 text-sm', getPriorityStyles(data.hint.prioridade))}>
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="outline" className="border-current text-[11px] uppercase tracking-wide">
                Prioridade: {data.hint.prioridade}
              </Badge>
              {selectedLoja && (
                <Badge variant="outline" className="text-[11px]">
                  Loja: {selectedLoja}
                </Badge>
              )}
              {selectedService && (
                <Badge variant="outline" className="text-[11px]">
                  Servico: {selectedService}
                </Badge>
              )}
            </div>
            <p>{data.hint.mensagem}</p>
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
                placeholder={loadingBase ? 'Carregando servicos...' : 'Escolha o servico'}
              />
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                className="w-full md:w-auto"
                onClick={() => {
                  setSelectedUnidade(defaultUnidade && defaultUnidade !== 'todas' ? defaultUnidade : '')
                  setSelectedService('')
                  setExternalSuggestions([])
                  setSuggestionsByGroup({})
                  setErrorMessage(null)
                }}
              >
                Limpar
              </Button>
            </div>
          </div>

          {errorMessage && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Sugestoes por nota</h3>
                <p className="text-xs text-muted-foreground">
                  A linha resume a nota, o servico identificado pela descricao e o melhor encaixe atual para distribuir.
                </p>
              </div>
              {(loadingBase || loadingNoteSuggestions) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {noteSuggestions.length === 0 && !loadingBase && !loadingNoteSuggestions && (
              <EmptyState>
                Nenhuma nota visivel no recorte atual para sugerir. Ajuste a loja, o servico ou os filtros do painel.
              </EmptyState>
            )}

            {noteSuggestions.length > 0 && (
              <div className="space-y-2">
                {noteSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.nota_id}
                    className="space-y-2 rounded-lg border px-3 py-3"
                  >
                    <p className="text-sm font-medium">
                      <span className="font-mono">{suggestion.numero_nota}</span>
                      <span className="px-1 text-muted-foreground">&gt;</span>
                      <span>{suggestion.servico ?? 'SERVICO NAO IDENTIFICADO'}</span>
                      <span className="px-1 text-muted-foreground">&gt;</span>
                      <span>{suggestion.destino_nome ?? 'SEM SUGESTAO'}</span>
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {suggestion.loja && (
                        <Badge variant="outline">{suggestion.loja}</Badge>
                      )}
                      <Badge variant={suggestion.destino_tipo === 'externo' ? 'secondary' : 'outline'}>
                        {suggestion.destino_tipo === 'externo' ? 'Externo' : suggestion.destino_tipo === 'interno' ? 'Interno' : 'Sem destino'}
                      </Badge>
                      {suggestion.match_mode && (
                        <Badge variant="outline">{getMatchModeLabel(suggestion.match_mode)}</Badge>
                      )}
                      {suggestion.historico_loja_servico > 0 && (
                        <Badge variant="outline">{suggestion.historico_loja_servico} loja + servico</Badge>
                      )}
                      {suggestion.historico_servico_geral > 0 && (
                        <Badge variant="outline">{suggestion.historico_servico_geral} servico geral</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Internos</h3>
                <p className="text-xs text-muted-foreground">
                  Menor carga de ordens primeiro; em seguida, menor volume de notas abertas.
                </p>
              </div>
              {loadingBase && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-2">
              {data.internos.map((internal) => (
                <div
                  key={internal.admin_id}
                  className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{internal.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {resolveCargoLabelFromEspecialidade(internal.especialidade)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{internal.qtd_ordens_ativas} ordens ativas</Badge>
                    <Badge variant="outline">{internal.qtd_notas_abertas} notas abertas</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {isCorrelationReady ? 'Externos mais aderentes' : 'Externos em campo agora'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isCorrelationReady
                    ? 'Ranking por historico do mesmo servico na loja; sem match exato, cai para o servico geral.'
                    : 'Selecione loja e servico para comparar os fornecedores externos com mais aderencia.'}
                </p>
              </div>
              {(loadingBase || loadingSuggestions) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {!isCorrelationReady && visibleExternalRows.length === 0 && !loadingBase && (
              <EmptyState>Nenhum operacional externo em execucao no momento.</EmptyState>
            )}

            {isCorrelationReady && visibleExternalRows.length === 0 && !loadingSuggestions && (
              <EmptyState>
                Nenhum externo com historico suficiente para este servico nessa loja. Tente outro servico ou distribua pelos internos.
              </EmptyState>
            )}

            {!isCorrelationReady && (
              <p className="text-xs text-muted-foreground">
                Mesmo sem filtro, as sugestoes por nota acima continuam usando a descricao da nota para procurar o melhor encaixe.
              </p>
            )}

            {visibleExternalRows.length > 0 && (
              <div className="space-y-2">
                {visibleExternalRows.map((external) => (
                  <div
                    key={external.fornecedor_codigo}
                    className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{external.fornecedor_nome}</p>
                      <p className="text-xs text-muted-foreground">Cod. {external.fornecedor_codigo}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{external.total_em_campo} em campo</Badge>
                      {isCorrelationReady && (
                        <>
                          <Badge variant="outline">{external.historico_loja_servico} loja + servico</Badge>
                          <Badge variant="outline">{external.historico_servico_geral} servico geral</Badge>
                          <Badge variant="outline">{getMatchModeLabel(external.match_mode)}</Badge>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
