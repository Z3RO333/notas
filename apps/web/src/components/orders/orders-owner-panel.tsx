'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OrdersBulkReassignBar } from '@/components/orders/orders-bulk-reassign-bar'
import { OrdersOwnerMiniCard } from '@/components/orders/orders-owner-mini-card'
import { OrdersOwnerAccordion } from '@/components/orders/orders-owner-accordion'
import type {
  OrderOwnerGroup,
  OrderOwnerMode,
  OrderReassignTarget,
  OrdemNotaAcompanhamento,
  OrdemStatusAcomp,
} from '@/lib/types/database'

interface OrdersOwnerPanelProps {
  rows: OrdemNotaAcompanhamento[]
  canReassign?: boolean
  reassignTargets?: OrderReassignTarget[]
}

type OrderStatusFilter = OrdemStatusAcomp | 'todas'

const OWNER_MODE_OPTIONS: Array<{ value: OrderOwnerMode; label: string }> = [
  { value: 'atual', label: 'Responsavel atual' },
  { value: 'origem', label: 'Responsavel de origem' },
]

const STATUS_FILTER_OPTIONS: Array<{ value: OrderStatusFilter; label: string }> = [
  { value: 'todas', label: 'Todos os status' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_tratativa', label: 'Em tratativa' },
  { value: 'concluida', label: 'Concluida' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'desconhecido', label: 'Desconhecido' },
]

function resolveOwner(row: OrdemNotaAcompanhamento, mode: OrderOwnerMode): { id: string; nome: string } {
  if (mode === 'origem') {
    return {
      id: row.administrador_id ?? '__sem_origem__',
      nome: row.administrador_nome ?? 'Sem responsavel de origem',
    }
  }

  return {
    id: row.responsavel_atual_id ?? '__sem_atual__',
    nome: row.responsavel_atual_nome ?? 'Sem responsavel atual',
  }
}

function buildGroups(rows: OrdemNotaAcompanhamento[], mode: OrderOwnerMode): OrderOwnerGroup[] {
  const map = new Map<string, OrderOwnerGroup>()

  for (const row of rows) {
    const owner = resolveOwner(row, mode)
    const current = map.get(owner.id) ?? {
      id: owner.id,
      nome: owner.nome,
      rows: [],
      recentes: 0,
      atencao: 0,
      atrasadas: 0,
      total: 0,
    }

    current.rows.push(row)
    current.total += 1
    if (row.semaforo_atraso === 'verde') current.recentes += 1
    if (row.semaforo_atraso === 'amarelo') current.atencao += 1
    if (row.semaforo_atraso === 'vermelho') current.atrasadas += 1

    map.set(owner.id, current)
  }

  return [...map.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

export function OrdersOwnerPanel({
  rows,
  canReassign = false,
  reassignTargets = [],
}: OrdersOwnerPanelProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('todas')
  const [ownerMode, setOwnerMode] = useState<OrderOwnerMode>('atual')
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null)
  const [selectedNotaIds, setSelectedNotaIds] = useState<string[]>([])

  const normalizedSearch = search.trim().toLowerCase()

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== 'todas' && row.status_ordem !== statusFilter) return false

      if (!normalizedSearch) return true

      return (
        row.numero_nota.toLowerCase().includes(normalizedSearch)
        || row.ordem_codigo.toLowerCase().includes(normalizedSearch)
        || (row.descricao ?? '').toLowerCase().includes(normalizedSearch)
      )
    })
  }, [rows, statusFilter, normalizedSearch])

  const groups = useMemo(() => buildGroups(filteredRows, ownerMode), [filteredRows, ownerMode])

  useEffect(() => {
    setExpandedOwnerId((prev) => {
      if (groups.length === 0) return null
      if (prev && groups.some((group) => group.id === prev)) return prev
      return groups[0].id
    })
  }, [groups])

  const visibleNotaIds = useMemo(
    () => Array.from(new Set(filteredRows.map((row) => row.nota_id))),
    [filteredRows]
  )

  useEffect(() => {
    setSelectedNotaIds((prev) => prev.filter((id) => visibleNotaIds.includes(id)))
  }, [visibleNotaIds])

  const selectedNotaIdsSet = useMemo(() => new Set(selectedNotaIds), [selectedNotaIds])
  const allVisibleSelected = visibleNotaIds.length > 0
    && visibleNotaIds.every((id) => selectedNotaIdsSet.has(id))

  const canBulkReassign = canReassign && reassignTargets.length > 0

  function handleCardClick(ownerId: string) {
    setExpandedOwnerId((prev) => (prev === ownerId ? null : ownerId))
  }

  function handleToggleRowSelection(notaId: string) {
    setSelectedNotaIds((prev) => (
      prev.includes(notaId)
        ? prev.filter((id) => id !== notaId)
        : [...prev, notaId]
    ))
  }

  function handleToggleSelectAll() {
    setSelectedNotaIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleNotaIds.includes(id))
      }

      const merged = new Set([...prev, ...visibleNotaIds])
      return Array.from(merged)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nota, ordem ou descricao..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as OrderStatusFilter)}>
          <SelectTrigger className="w-full xl:w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerMode} onValueChange={(value) => setOwnerMode(value as OrderOwnerMode)}>
          <SelectTrigger className="w-full xl:w-56">
            <SelectValue placeholder="Agrupar por" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canBulkReassign && filteredRows.length > 0 && (
        <div className="flex items-center justify-end">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={allVisibleSelected}
              onChange={handleToggleSelectAll}
            />
            Selecionar visiveis
          </label>
        </div>
      )}

      {canBulkReassign && selectedNotaIds.length > 0 && (
        <OrdersBulkReassignBar
          selectedNotaIds={selectedNotaIds}
          admins={reassignTargets}
          onClearSelection={() => setSelectedNotaIds([])}
          onReassigned={() => setSelectedNotaIds([])}
        />
      )}

      {groups.length > 0 ? (
        <>
          <div className="sticky top-14 z-40 bg-background/95 pb-3 pt-1 backdrop-blur">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {groups.map((group) => (
                <OrdersOwnerMiniCard
                  key={group.id}
                  group={group}
                  isExpanded={expandedOwnerId === group.id}
                  onClick={() => handleCardClick(group.id)}
                />
              ))}
            </div>
          </div>

          {groups.map((group) => (
            <OrdersOwnerAccordion
              key={group.id}
              group={group}
              isOpen={expandedOwnerId === group.id}
              canReassign={canBulkReassign}
              selectedNotaIds={selectedNotaIdsSet}
              onToggleRowSelection={handleToggleRowSelection}
            />
          ))}
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma ordem encontrada com os filtros selecionados.
        </div>
      )}
    </div>
  )
}
