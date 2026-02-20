import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { type ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { DataGrid } from '@/components/data-grid/data-grid'
import { OrderReassignDialog } from '@/components/orders/order-reassign-dialog'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type { OrdemNotaAcompanhamento, OrderOwnerGroup, OrderReassignTarget } from '@/lib/types/database'

interface OrdersOwnerAccordionProps {
  group: OrderOwnerGroup
  isOpen: boolean
  canReassign: boolean
  selectedNotaIds: Set<string>
  onToggleRowSelection: (notaId: string) => void
  reassignTargets?: OrderReassignTarget[]
}

function formatIsoDate(value: string): string {
  const datePart = value.split('T')[0]
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function OrdersOwnerAccordion({
  group,
  isOpen,
  canReassign,
  selectedNotaIds,
  onToggleRowSelection,
  reassignTargets = [],
}: OrdersOwnerAccordionProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && ref.current) {
      const timer = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const rows = useMemo(() => sortOrdersByPriority(group.rows), [group.rows])

  const allSelected = rows.length > 0 && rows.every((row) => selectedNotaIds.has(row.nota_id))

  function setGroupSelection(nextSelected: boolean) {
    for (const row of rows) {
      const isSelected = selectedNotaIds.has(row.nota_id)
      if (nextSelected && !isSelected) onToggleRowSelection(row.nota_id)
      if (!nextSelected && isSelected) onToggleRowSelection(row.nota_id)
    }
  }

  const columns = useMemo<ColumnDef<OrdemNotaAcompanhamento, unknown>[]>(() => [
    {
      id: 'select',
      header: () => (
        canReassign ? (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => setGroupSelection(event.target.checked)}
            aria-label={`Selecionar ordens de ${group.nome}`}
          />
        ) : null
      ),
      cell: ({ row }) => (
        canReassign ? (
          <input
            type="checkbox"
            checked={selectedNotaIds.has(row.original.nota_id)}
            onChange={() => onToggleRowSelection(row.original.nota_id)}
            aria-label={`Selecionar nota ${row.original.numero_nota}`}
          />
        ) : null
      ),
    },
    {
      id: 'nota_ordem',
      header: 'Nota • Ordem',
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <Link href={`/notas/${row.original.nota_id}`} className="font-mono text-sm font-semibold hover:underline">
            {row.original.numero_nota} • Ordem {row.original.ordem_codigo}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.original.descricao ?? 'Sem descrição'}</p>
        </div>
      ),
    },
    {
      id: 'semaforo',
      header: 'Prioridade',
      cell: ({ row }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.original.semaforo_atraso)}`}>
          {getSemaforoLabel(row.original.semaforo_atraso)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(row.original.status_ordem)}`}>
          {getOrderStatusLabel(row.original.status_ordem)}
        </span>
      ),
    },
    {
      id: 'responsaveis',
      header: 'Responsabilidade',
      cell: ({ row }) => (
        <div className="space-y-0.5 text-xs">
          <p><span className="text-muted-foreground">Atual:</span> {row.original.responsavel_atual_nome ?? 'Sem responsável'}</p>
          <p><span className="text-muted-foreground">Origem:</span> {row.original.administrador_nome ?? 'Não identificado'}</p>
        </div>
      ),
    },
    {
      id: 'idade',
      header: 'Idade',
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          <p>{row.original.dias_em_aberto} dia(s)</p>
          <p>{formatIsoDate(row.original.ordem_detectada_em)}</p>
        </div>
      ),
    },
    {
      id: 'unidade',
      header: 'Unidade',
      cell: ({ row }) => row.original.unidade ?? 'Sem unidade',
    },
    {
      id: 'acoes',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canReassign && reassignTargets.length > 0 && (
            <OrderReassignDialog
              notaId={row.original.nota_id}
              notaNumero={row.original.numero_nota}
              ordemCodigo={row.original.ordem_codigo}
              currentAdminId={row.original.responsavel_atual_id}
              admins={reassignTargets}
            />
          )}
          <Link
            href={`/notas/${row.original.nota_id}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="Ver detalhes"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ),
    },
  ], [allSelected, canReassign, group.nome, selectedNotaIds, reassignTargets])

  return (
    <div ref={ref} className="accordion-grid" data-state={isOpen ? 'open' : 'closed'}>
      <div className="accordion-content">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base">{group.nome}</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {group.total} ordem{group.total !== 1 ? 'ns' : ''}
              {group.atrasadas > 0 && (
                <span className="ml-1 text-red-600">({group.atrasadas} atrasada{group.atrasadas !== 1 ? 's' : ''})</span>
              )}
            </span>
          </div>

          <DataGrid
            data={rows}
            columns={columns}
            getRowId={(row) => row.ordem_id}
            emptyMessage="Nenhuma ordem encontrada para este agrupamento."
            rowClassName={(row) => row.semaforo_atraso === 'vermelho' ? 'bg-red-50/50' : ''}
          />
        </div>
      </div>
    </div>
  )
}
