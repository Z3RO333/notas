'use client'

import Link from 'next/link'
import { Copy, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
import { useToast } from '@/components/ui/toast'
import { copyToClipboard } from '@/lib/orders/copy'
import { getSemaforoClass, getSemaforoLabel } from '@/lib/orders/metrics'
import type { OrdemNotaAcompanhamento, OrderReassignTarget } from '@/lib/types/database'

interface OrderCompactCardReassignProps {
  admins: OrderReassignTarget[]
  currentAdminId: string | null
  skipRouterRefresh?: boolean
  onReassigned?: (result: { notaId: string; novoAdminId: string }) => void
}

interface OrderCompactCardProps {
  row: OrdemNotaAcompanhamento
  selected?: boolean
  showCheckbox?: boolean
  onToggleSelection?: (notaId: string) => void
  showReassign?: boolean
  reassignProps?: OrderCompactCardReassignProps
  onOpenDetails?: () => void
  notaLinkHref?: string
  highlightQuery?: string
}

const SEMAFORO_BORDER_LEFT_CLASS = {
  verde: 'border-l-emerald-500',
  amarelo: 'border-l-amber-500',
  vermelho: 'border-l-red-500',
  neutro: 'border-l-slate-300',
} as const

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeHighlightQuery(value: string | null | undefined): string {
  const query = (value ?? '').trim()
  return query.length >= 2 ? query : ''
}

function renderHighlightedText(value: string, query: string) {
  if (!query) return value
  const pattern = new RegExp(`(${escapeRegExp(query)})`, 'ig')
  const parts = value.split(pattern)
  if (parts.length <= 1) return value

  return (
    <>
      {parts.map((part, index) => (
        part.toLowerCase() === query.toLowerCase()
          ? (
            <mark key={`${part}-${index}`} className="rounded bg-yellow-100 px-0.5 text-foreground">
              {part}
            </mark>
            )
          : <span key={`${part}-${index}`}>{part}</span>
      ))}
    </>
  )
}

export function OrderCompactCard({
  row,
  selected = false,
  showCheckbox = false,
  onToggleSelection,
  showReassign = false,
  reassignProps,
  onOpenDetails,
  notaLinkHref,
  highlightQuery,
}: OrderCompactCardProps) {
  const { toast } = useToast()
  const isClickable = typeof onOpenDetails === 'function'
  const linkedNotaId = (row.nota_id ?? '').trim() || null
  const hasLinkedNote = Boolean(linkedNotaId)
  const notaNumero = (row.numero_nota ?? '').trim() || 'Sem nota'
  const ordemCodigo = row.ordem_codigo?.trim() ?? ''
  const hasOrderCode = Boolean(ordemCodigo)
  const ordemText = hasOrderCode ? ordemCodigo : 'Sem ordem'
  const unidadeText = row.unidade?.trim() ? row.unidade : 'Sem unidade'
  const responsavelText = row.responsavel_atual_nome?.trim() ? row.responsavel_atual_nome : 'Sem responsável'
  const diasText = `Há ${row.dias_em_aberto} dia(s)`
  const dataText = row.ordem_detectada_em
    ? format(new Date(row.ordem_detectada_em), 'dd/MM/yyyy')
    : null
  const descricao = row.descricao?.trim() || null
  const descricaoCard = descricao ?? (!hasLinkedNote ? 'Ordem PMPL sem nota vinculada' : null)
  const semaforoBorder = SEMAFORO_BORDER_LEFT_CLASS[row.semaforo_atraso] ?? SEMAFORO_BORDER_LEFT_CLASS.neutro
  const highlightedQuery = normalizeHighlightQuery(highlightQuery)

  function handleToggleSelection(event: React.MouseEvent | React.ChangeEvent) {
    event.stopPropagation()
    if (!onToggleSelection || !linkedNotaId) return
    onToggleSelection(linkedNotaId)
  }

  function handleOpenDetails() {
    if (!onOpenDetails) return
    onOpenDetails()
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isClickable) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpenDetails?.()
  }

  async function handleCopyValue(value: string, label: 'ORDEM' | 'NOTA') {
    const copied = await copyToClipboard(value)
    if (!copied) {
      toast({
        title: `Falha ao copiar ${label}`,
        description: 'Não foi possível copiar para a área de transferência.',
        variant: 'error',
      })
      return
    }

    toast({
      title: `${label} ${value} copiada ✅`,
      variant: 'success',
    })
  }

  function handleCopyNote(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!hasLinkedNote) return
    void handleCopyValue(notaNumero, 'NOTA')
  }

  function handleCopyOrder(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (event.altKey && hasLinkedNote) {
      void handleCopyValue(notaNumero, 'NOTA')
      return
    }

    if (hasOrderCode) {
      void handleCopyValue(ordemCodigo, 'ORDEM')
      return
    }

    if (hasLinkedNote) {
      void handleCopyValue(notaNumero, 'NOTA')
    }
  }

  return (
    <div
      className={`group rounded-lg border border-l-4 bg-card px-3 py-2.5 transition-all ${semaforoBorder} ${
        selected ? 'ring-2 ring-primary/60' : ''
      } ${
        isClickable ? 'cursor-pointer hover:shadow-md' : 'hover:bg-muted/30'
      }`}
      onClick={handleOpenDetails}
      onKeyDown={handleCardKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Linha 1: identificação + semáforo + ações */}
      <div className="flex items-center gap-2">
        {showCheckbox && hasLinkedNote && (
          <input
            type="checkbox"
            checked={selected}
            onClick={handleToggleSelection}
            onChange={handleToggleSelection}
            aria-label={`Selecionar nota ${notaNumero}`}
            className="shrink-0"
          />
        )}

        <span className="min-w-0 flex-1 font-mono text-sm font-medium leading-5 truncate">
          <span className="flex min-w-0 items-center gap-1.5">
            {hasLinkedNote && (
              <button
                type="button"
                onClick={handleCopyNote}
                className="inline-flex shrink-0 items-center rounded-md px-1 text-foreground transition-colors hover:bg-muted"
                title={`Copiar NOTA ${notaNumero}`}
              >
                #{renderHighlightedText(notaNumero, highlightedQuery)}
              </button>
            )}

            {hasOrderCode ? (
              <>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={handleCopyOrder}
                  className="inline-flex min-w-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-900 transition-colors hover:bg-blue-100"
                  title={hasLinkedNote
                    ? `Clique para copiar ORDEM ${ordemCodigo}. Alt+Clique copia NOTA ${notaNumero}.`
                    : `Copiar ORDEM ${ordemCodigo}`
                  }
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Ordem</span>
                  <span className="text-sm font-semibold">
                    {renderHighlightedText(ordemCodigo, highlightedQuery)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyOrder}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-blue-700 transition-colors hover:bg-blue-100"
                  title={`Copiar ORDEM ${ordemCodigo}`}
                  aria-label={`Copiar ordem ${ordemCodigo}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Sem ordem
              </span>
            )}

            {!hasLinkedNote && (
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Sem nota
              </span>
            )}
          </span>
        </span>

        <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
            {getSemaforoLabel(row.semaforo_atraso)}
          </span>

          {showReassign && hasLinkedNote && linkedNotaId && reassignProps && reassignProps.admins.length > 0 && (
            <OrderReassignDialog
              notaId={linkedNotaId}
              notaNumero={notaNumero}
              ordemCodigo={row.ordem_codigo}
              currentAdminId={reassignProps.currentAdminId}
              admins={reassignProps.admins}
              skipRouterRefresh={reassignProps.skipRouterRefresh}
              onReassigned={reassignProps.onReassigned}
            />
          )}

          {hasLinkedNote && notaLinkHref && (
            <Link
              href={notaLinkHref}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={`Abrir nota ${notaNumero}`}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* Linha 2: texto breve (condicional) */}
      {descricaoCard && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground leading-5">
          {renderHighlightedText(descricaoCard, highlightedQuery)}
        </p>
      )}

      {/* Linha 3: metadados */}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {renderHighlightedText(unidadeText, highlightedQuery)}
        <span className="mx-1 opacity-40">·</span>
        {renderHighlightedText(responsavelText, highlightedQuery)}
        <span className="mx-1 opacity-40">·</span>
        {diasText}
        {dataText && (
          <>
            <span className="mx-1 opacity-40">·</span>
            {dataText}
          </>
        )}
      </p>
    </div>
  )
}
