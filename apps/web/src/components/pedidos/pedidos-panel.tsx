'use client'

import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PedidosAccordion } from '@/components/pedidos/pedidos-accordion'
import { PedidosKpiStrip } from '@/components/pedidos/pedidos-kpi-strip'
import { FornecedoresCarteiraPanel } from '@/components/pedidos/fornecedores-carteira-panel'
import { cn } from '@/lib/utils'
import type {
  PedidoCompraStatus,
  PedidosAdminSummary,
  PedidosFiltrosResponse,
  PedidosSummaryResponse,
} from '@/lib/types/pedidos'

type PedidosSubaba = 'pedidos' | 'fornecedores'

const SUBABA_OPTIONS: Array<{ id: PedidosSubaba; label: string }> = [
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'fornecedores', label: 'Carteira de Fornecedores' },
]

function PedidosSubabaToggle({ value, onChange }: { value: PedidosSubaba; onChange: (next: PedidosSubaba) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-full border border-border/60 bg-muted/30 p-1">
      {SUBABA_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            value === option.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface PedidosSummaryParams {
  q: string
  status: PedidoCompraStatus | 'all'
  anoExtracao: string | null
  mesExtracao: string | null
}

function usePedidosSummary({ q, status, anoExtracao, mesExtracao }: PedidosSummaryParams) {
  return useQuery<PedidosAdminSummary[]>({
    queryKey: ['pedidos-summary', q, status, anoExtracao, mesExtracao],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status !== 'all') params.set('status', status)
      params.set('ano', anoExtracao ?? 'all')
      if (mesExtracao) params.set('mes', mesExtracao)
      const res = await fetch(`/api/pedidos/summary?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar resumo de pedidos')
      }
      const data = (await res.json()) as PedidosSummaryResponse
      return data.admins
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}

interface PedidosFiltrosMetaParams {
  q: string
  status: PedidoCompraStatus | 'all'
  anoExtracao: string | null
  mesExtracao: string | null
}

function usePedidosFiltrosMeta({ q, status, anoExtracao, mesExtracao }: PedidosFiltrosMetaParams) {
  return useQuery<PedidosFiltrosResponse>({
    queryKey: ['pedidos-filtros-meta', q, status, anoExtracao, mesExtracao],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status !== 'all') params.set('status', status)
      params.set('ano', anoExtracao ?? 'all')
      if (mesExtracao) params.set('mes', mesExtracao)
      const res = await fetch(`/api/pedidos/filtros?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar filtros de pedidos')
      }
      return res.json() as Promise<PedidosFiltrosResponse>
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}

interface PedidosPanelProps {
  isGestor: boolean
}

export function PedidosPanel({ isGestor }: PedidosPanelProps) {
  const [subaba, setSubaba] = useState<PedidosSubaba>('pedidos')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<PedidoCompraStatus | 'all'>('all')
  const [anoExtracao, setAnoExtracao] = useState<string | null>(null)
  const [mesExtracao, setMesExtracao] = useState<string | null>(null)

  const { data: admins, isPending, error } = usePedidosSummary({ q, status, anoExtracao, mesExtracao })
  const { data: filtrosMeta } = usePedidosFiltrosMeta({ q, status, anoExtracao, mesExtracao })
  const meta = filtrosMeta ?? { availableAnos: [], availableMeses: [] }
  const kpis = filtrosMeta?.kpis ?? { total: 0, em_aberto: 0, encerrado: 0, cancelado: 0, valor_total: 0 }

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const globalFilters = { q, status, anoExtracao, mesExtracao }

  function handleRowClick(adminId: string) {
    setExpandedId((prev) => (prev === adminId ? null : adminId))
  }

  if (subaba === 'fornecedores') {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <FornecedoresCarteiraPanel isGestor={isGestor} />
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <PedidosKpiStrip
          kpis={{ total: 0, em_aberto: 0, encerrado: 0, cancelado: 0, valor_total: 0 }}
          loading
        />
        <Card>
          <CardContent className="p-0">
            <div className="space-y-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Erro ao carregar pedidos.'}
        </p>
      </div>
    )
  }

  if (!admins || admins.length === 0) {
    return (
      <div className="space-y-4">
        <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Nenhum administrador encontrado.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
    <PedidosSubabaToggle value={subaba} onChange={setSubaba} />
    <PedidosKpiStrip kpis={kpis} />

    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar fornecedor ou pedido..."
          className="pl-8 pr-8 h-8 text-sm"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setQ('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Select
        value={status}
        onValueChange={(val) => setStatus(val as PedidoCompraStatus | 'all')}
      >
        <SelectTrigger className="w-[130px] h-8 text-sm">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          <SelectItem value="em_aberto">Em aberto</SelectItem>
          <SelectItem value="encerrado">Encerrado</SelectItem>
          <SelectItem value="cancelado">Cancelado</SelectItem>
        </SelectContent>
      </Select>

      {meta.availableAnos.length > 0 && (
        <Select
          value={anoExtracao ?? 'all'}
          onValueChange={(val) => {
            setAnoExtracao(val === 'all' ? null : val)
            setMesExtracao(null)
          }}
        >
          <SelectTrigger className="w-[100px] h-8 text-sm">
            <SelectValue placeholder="Ano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os anos</SelectItem>
            {meta.availableAnos.map((ano) => (
              <SelectItem key={ano} value={ano}>{ano}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {meta.availableMeses.length > 0 && (
        <Select
          value={mesExtracao ?? 'all'}
          onValueChange={(val) => setMesExtracao(val === 'all' ? null : val)}
        >
          <SelectTrigger className="w-[110px] h-8 text-sm">
            <SelectValue placeholder="Mês" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os meses</SelectItem>
            {meta.availableMeses.map((mes) => (
              <SelectItem key={mes} value={mes}>
                {mes.slice(4, 6)}/{mes.slice(0, 4)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>

    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Pedidos por Colaborador
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordenado por pedidos em aberto. Clique em uma linha para ver os pedidos do colaborador.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="w-8 px-3 py-2"><span className="sr-only">Expandir</span></th>
                <th className="w-8 px-2 py-2 text-center font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Colaborador</th>
                <th className="px-4 py-2 text-right font-medium">Em Aberto</th>
                <th className="px-4 py-2 text-right font-medium">Encerrado</th>
                <th className="px-4 py-2 text-right font-medium">Cancelado</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin, index) => {
                const isExpanded = expandedId === admin.adminId
                const adminTotal = admin.em_aberto + admin.encerrado + admin.cancelado
                const pct = kpis.total > 0 ? ((adminTotal / kpis.total) * 100).toFixed(1) : '0.0'

                return (
                  <Fragment key={admin.adminId}>
                    <tr
                      className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/20"
                      onClick={() => handleRowClick(admin.adminId)}
                    >
                      <td className="w-8 px-3 py-3 text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td className="w-8 px-2 py-3 text-center text-xs text-muted-foreground">
                        #{index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{admin.nome}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {pct}% dos pedidos
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={
                            admin.em_aberto > 0
                              ? 'font-medium text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {admin.em_aberto.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {admin.encerrado.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={
                            admin.cancelado > 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {admin.cancelado.toLocaleString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {adminTotal.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b bg-muted/5 last:border-0">
                        <td colSpan={7} className="p-0">
                          <PedidosAccordion
                            key={admin.adminId}
                            adminId={admin.adminId}
                            isOpen={true}
                            filters={globalFilters}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    </div>
  )
}
