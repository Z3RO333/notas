'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
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
}

const SEMAFORO_BORDER_LEFT_CLASS = {
  verde: 'border-l-emerald-500',
  amarelo: 'border-l-amber-500',
  vermelho: 'border-l-red-500',
  neutro: 'border-l-slate-300',
} as const

export function OrderCompactCard({
  row,
  selected = false,
  showCheckbox = false,
  onToggleSelection,
  showReassign = false,
  reassignProps,
  onOpenDetails,
  notaLinkHref,
}: OrderCompactCardProps) {
  const isClickable = typeof onOpenDetails === 'function'
  const linkedNotaId = (row.nota_id ?? '').trim() || null
  const hasLinkedNote = Boolean(linkedNotaId)
  const notaNumero = (row.numero_nota ?? '').trim() || 'Sem nota'
  const ordemText = row.ordem_codigo?.trim() ? row.ordem_codigo : 'Sem ordem'
  const unidadeText = row.unidade?.trim() ? row.unidade : 'Sem unidade'
  const responsavelText = row.responsavel_atual_nome?.trim() ? row.responsavel_atual_nome : 'Sem responsável'
  const diasText = `Há ${row.dias_em_aberto} dia(s)`
  const dataText = row.ordem_detectada_em
    ? format(new Date(row.ordem_detectada_em), 'dd/MM/yyyy')
    : null
  const descricao = row.descricao?.trim() || null
  const descricaoCard = descricao ?? (!hasLinkedNote ? 'Ordem PMPL sem nota vinculada' : null)
  const semaforoBorder = SEMAFORO_BORDER_LEFT_CLASS[row.semaforo_atraso] ?? SEMAFORO_BORDER_LEFT_CLASS.neutro

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
          {hasLinkedNote ? (
            <>
              <span className="text-foreground">#{notaNumero}</span>
              {row.ordem_codigo?.trim() && (
                <span className="text-muted-foreground"> · {ordemText}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-foreground">{ordemText}</span>
              <span className="ml-2 inline-flex rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Sem nota
              </span>
            </>
          )}
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
          {descricaoCard}
        </p>
      )}

      {/* Linha 3: metadados */}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {unidadeText}
        <span className="mx-1 opacity-40">·</span>
        {responsavelText}
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
