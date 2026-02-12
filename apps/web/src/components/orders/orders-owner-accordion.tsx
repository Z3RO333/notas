import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { type ColumnDef } from '@tanstack/react-table'
import { DataGrid } from '@/components/data-grid/data-grid'
import { Avatar } from '@/components/ui/avatar'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type { OrdemNotaAcompanhamento, OrderOwnerGroup } from '@/lib/types/database'

interface OrdersOwnerAccordionProps {
  group: OrderOwnerGroup
  isOpen: boolean
  canReassign: boolean
  selectedNotaIds: Set<string>
  onToggleRowSelection: (notaId: string) => void
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
            #{row.original.numero_nota} • Ordem {row.original.ordem_codigo}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{row.original.descricao ?? 'Sem descricao'}</p>
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
          <p><span className="text-muted-foreground">Atual:</span> {row.original.responsavel_atual_nome ?? 'Sem responsavel'}</p>
          <p><span className="text-muted-foreground">Origem:</span> {row.original.administrador_nome ?? 'Nao identificado'}</p>
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
  ], [allSelected, canReassign, group.nome, selectedNotaIds])

  return (
    <div ref={ref} className="accordion-grid" data-state={isOpen ? 'open' : 'closed'}>
      <div className="accordion-content">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar src={group.avatar_url} nome={group.nome} size="sm" />
              <h3 className="text-base font-semibold">{group.nome}</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {group.total} ordem{group.total !== 1 ? 's' : ''}
            </span>
          </div>

          <DataGrid
            data={rows}
            columns={columns}
            getRowId={(row) => row.ordem_id}
            emptyMessage="Nenhuma ordem encontrada para este agrupamento."
          />
        </div>
      </div>
    </div>
  )
}
