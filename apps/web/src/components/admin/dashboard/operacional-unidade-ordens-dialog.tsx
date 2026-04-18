'use client'

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type OperacionalOrderRow = {
  id: string
  ordem_codigo: string | null
  unidade: string | null
  fornecedor_codigo: string | null
  fornecedor_nome: string | null
  status_ordem_raw: string | null
  ordem_detectada_em: string | null
  data_entrada: string | null
  tipo_ordem: string | null
  texto_breve: string | null
  numero_nota: string | null
}

type OperacionalOrdersResponse = {
  unidade: string
  fornecedorCodigo: string | null
  summary: {
    total: number
    atendidas: number
    pendentes: number
  }
  rows: OperacionalOrderRow[]
}

type RowFilter = 'todas' | 'pendentes' | 'atendidas'

const STATUS_ATENDIDAS = new Set([
  'CANCELADO',
  'CONCLUIDO',
  'AGUARDANDO_FATURAMENTO_NF',
  'EXECUCAO_SATISFATORIO',
  'EXECUCAO_SATISFATORIA',
  'AVALIACAO_DA_EXECUCAO',
  'AVALIACAO_DE_EXECUCAO',
])

const STATUS_PENDENTES = new Set([
  'ABERTO',
  'ABERTA',
  'EM_EXECUCAO',
  'EQUIPAMENTO_EM_CONSERTO',
  'EXECUCAO_NAO_REALIZADA',
  'ENVIAR_EMAIL_PFORNECEDOR',
  'EM_PROCESSAMENTO',
  'EXECUCAO_INSATISFATORIO',
])

const STATUS_LABEL: Record<string, string> = {
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluido',
  AGUARDANDO_FATURAMENTO_NF: 'Ag. Fat. NF',
  EXECUCAO_SATISFATORIO: 'Exec. Satisfatorio',
  EXECUCAO_SATISFATORIA: 'Exec. Satisfatoria',
  AVALIACAO_DA_EXECUCAO: 'Aval. Execucao',
  AVALIACAO_DE_EXECUCAO: 'Aval. Execucao',
  ABERTO: 'Aberto',
  ABERTA: 'Aberta',
  EM_EXECUCAO: 'Em Execucao',
  EQUIPAMENTO_EM_CONSERTO: 'Equip. Conserto',
  EXECUCAO_NAO_REALIZADA: 'Exec. Nao Real.',
  ENVIAR_EMAIL_PFORNECEDOR: 'Email Fornecedor',
  EM_PROCESSAMENTO: 'Em Processamento',
  EXECUCAO_INSATISFATORIO: 'Exec. Insatisfatorio',
}

interface OperacionalUnidadeOrdensDialogProps {
  unidade: string
  startIso: string
  endExclusiveIso: string
  periodLabel: string
  fornecedorCodigo?: string | null
  initialFilter?: RowFilter
  open: boolean
  onClose: () => void
}

function normalizeStatus(value: string | null): string {
  return (value ?? '').trim().toUpperCase()
}

function getStatusVariant(status: string | null): 'outline' | 'concluida' | 'em_andamento' {
  const normalized = normalizeStatus(status)
  if (STATUS_ATENDIDAS.has(normalized)) return 'concluida'
  if (STATUS_PENDENTES.has(normalized)) return 'em_andamento'
  return 'outline'
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function matchesFilter(row: OperacionalOrderRow, filter: RowFilter): boolean {
  if (filter === 'todas') return true
  const status = normalizeStatus(row.status_ordem_raw)
  if (filter === 'pendentes') return STATUS_PENDENTES.has(status)
  return STATUS_ATENDIDAS.has(status)
}

export function OperacionalUnidadeOrdensDialog({
  unidade,
  startIso,
  endExclusiveIso,
  periodLabel,
  fornecedorCodigo,
  initialFilter = 'todas',
  open,
  onClose,
}: OperacionalUnidadeOrdensDialogProps) {
  const [payload, setPayload] = useState<OperacionalOrdersResponse | null>(null)
  const [filter, setFilter] = useState<RowFilter>(initialFilter)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const params = new URLSearchParams({
      unidade,
      start: startIso,
      end: endExclusiveIso,
    })

    if (fornecedorCodigo) {
      params.set('fornecedor', fornecedorCodigo)
    }

    setLoading(true)
    setError(null)
    setFilter(initialFilter)

    fetch(`/api/operacional/unidades/ordens?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const nextPayload = await response.json()
        if (!response.ok) {
          throw new Error(nextPayload.error ?? 'Falha ao carregar ordens da unidade')
        }
        setPayload(nextPayload as OperacionalOrdersResponse)
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return
        setPayload(null)
        setError(fetchError instanceof Error ? fetchError.message : 'Falha ao carregar ordens da unidade')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [open, unidade, startIso, endExclusiveIso, fornecedorCodigo, initialFilter])

  const filteredRows = useMemo(() => {
    if (!payload) return []
    return payload.rows.filter((row) => matchesFilter(row, filter))
  }, [payload, filter])

  const showFornecedorColumn = useMemo(() => {
    if (fornecedorCodigo || !payload) return false
    return payload.rows.some((row) => row.fornecedor_nome || row.fornecedor_codigo)
  }, [fornecedorCodigo, payload])

  const summary = payload?.summary ?? { total: 0, atendidas: 0, pendentes: 0 }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="flex max-h-[85vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{unidade}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Operacional - {periodLabel}
            {fornecedorCodigo ? ` - fornecedor ${fornecedorCodigo}` : ''}
          </p>
        </DialogHeader>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando ordens da unidade...</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-destructive">{error}</p>
        ) : !payload || payload.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma ordem encontrada para esta unidade.</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{summary.total.toLocaleString('pt-BR')}</p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendentes</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {summary.pendentes.toLocaleString('pt-BR')}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendidas</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {summary.atendidas.toLocaleString('pt-BR')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={filter === 'todas' ? 'default' : 'outline'}
                onClick={() => setFilter('todas')}
              >
                Todas ({summary.total})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filter === 'pendentes' ? 'default' : 'outline'}
                onClick={() => setFilter('pendentes')}
              >
                Pendentes ({summary.pendentes})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filter === 'atendidas' ? 'default' : 'outline'}
                onClick={() => setFilter('atendidas')}
              >
                Atendidas ({summary.atendidas})
              </Button>
            </div>

            <div className="flex-1 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b bg-background">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Ordem</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Detectada em</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entrada</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Serviço</th>
                    {showFornecedorColumn && (
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fornecedor</th>
                    )}
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{row.ordem_codigo ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.tipo_ordem ?? '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge variant={getStatusVariant(row.status_ordem_raw)}>
                          {STATUS_LABEL[normalizeStatus(row.status_ordem_raw)] ?? row.status_ordem_raw ?? '-'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.ordem_detectada_em)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.data_entrada)}</td>
                      <td className="max-w-[280px] px-3 py-2">{row.texto_breve ?? '-'}</td>
                      {showFornecedorColumn && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.fornecedor_nome ?? row.fornecedor_codigo ?? '-'}
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">{row.numero_nota ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-right text-xs text-muted-foreground">
              {filteredRows.length.toLocaleString('pt-BR')} ordens exibidas
              {payload.rows.length === 500 ? ' (limite 500)' : ''}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
