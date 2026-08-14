'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { FornecedoresCarteiraPanel } from '@/components/pedidos/fornecedores-carteira-panel'
import { PedidoDetailDrawer } from '@/components/pedidos/pedido-detail-drawer'
import { PedidoRow } from '@/components/pedidos/pedido-row'
import { PedidosKpiStrip } from '@/components/pedidos/pedidos-kpi-strip'
import { usePedidosData } from '@/components/pedidos/use-pedidos-data'
import { usePedidosFilters } from '@/components/pedidos/use-pedidos-filters'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type {
  PedidoCompra,
  PedidoCompraStatusEfetivo,
  PedidosAdminSummary,
  PedidosSummaryResponse,
  PedidosWorkspaceFilters,
} from '@/lib/types/pedidos'

export type PedidosSubaba = 'pedidos' | 'corretivas' | 'preventivas_anuais'

const SUBABA_OPTIONS: Array<{ id: PedidosSubaba; label: string }> = [
  { id: 'pedidos', label: 'Visão geral' },
  { id: 'corretivas', label: 'Carteira corretiva' },
  { id: 'preventivas_anuais', label: 'Contratos preventivos' },
]

const STATUS_OPTIONS: Array<{ value: PedidoCompraStatusEfetivo | 'all'; label: string }> = [
  { value: 'all', label: 'Todos os status' },
  { value: 'em_aberto', label: 'Em aberto' },
  { value: 'encerrado', label: 'Encerrado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'indeterminado', label: 'Status a revisar' },
]

function fmtCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
  }).format(value)
}

function fmtFreshness(value: string | null | undefined): string {
  if (!value) return 'Atualização não informada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `Dados até ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`
}

function changeViewInUrl(view: PedidosSubaba) {
  const params = new URLSearchParams(window.location.search)
  if (view === 'pedidos') params.delete('visao')
  else params.set('visao', view)
  const query = params.toString()
  window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname)
}

function PedidosSubabaToggle({ value, onChange }: { value: PedidosSubaba; onChange: (next: PedidosSubaba) => void }) {
  return (
    <div role="tablist" aria-label="Visões de pedidos de compra" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border/70 bg-muted/30 p-1">
      {SUBABA_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === option.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function usePedidosSummary(filters: PedidosWorkspaceFilters) {
  return useQuery<PedidosSummaryResponse>({
    queryKey: ['pedidos-summary', filters.q, filters.status, filters.anoExtracao, filters.mesExtracao],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (filters.q) params.set('q', filters.q)
      if (filters.status !== 'all') params.set('status', filters.status)
      params.set('ano', filters.anoExtracao ?? 'all')
      if (filters.mesExtracao) params.set('mes', filters.mesExtracao)
      const response = await fetch(`/api/pedidos/summary?${params.toString()}`, { cache: 'no-store', signal })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar resumo por responsável')
      }
      return response.json() as Promise<PedidosSummaryResponse>
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border p-3">
      {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
    </div>
  )
}

function ResponsaveisSummary({ admins, total }: { admins: PedidosAdminSummary[]; total: number }) {
  if (admins.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum responsável encontrado neste recorte.</p>
  }

  return (
    <>
      <div className="space-y-2 md:hidden">
        {admins.map((admin, index) => {
          const adminTotal = admin.em_aberto + admin.encerrado + admin.cancelado + (admin.indeterminado ?? 0)
          const completionRate = adminTotal > 0 ? Math.round((admin.encerrado / adminTotal) * 100) : 0
          return (
            <div key={admin.adminId} className="rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Avatar src={admin.avatar_url} nome={admin.nome} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{index + 1}. {admin.nome}</p>
                  <p className="text-xs text-muted-foreground">{completionRate}% encerrados · {fmtCurrency(admin.valor_total)}</p>
                </div>
                <Badge variant={admin.em_aberto > 0 ? 'warning' : 'outline'}>{admin.em_aberto} abertos</Badge>
              </div>
            </div>
          )
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-medium">Ranking</th>
            <th className="px-4 py-2.5 text-left font-medium">Responsável atual</th>
            <th className="px-4 py-2.5 text-right font-medium">Em aberto</th>
            <th className="px-4 py-2.5 text-right font-medium">Encerrados</th>
            <th className="px-4 py-2.5 text-right font-medium">Taxa encerrada</th>
            <th className="px-4 py-2.5 text-right font-medium">A revisar</th>
            <th className="px-4 py-2.5 text-right font-medium">Valor do recorte</th>
          </tr></thead>
          <tbody className="divide-y">
            {admins.map((admin, index) => {
              const adminTotal = admin.em_aberto + admin.encerrado + admin.cancelado + (admin.indeterminado ?? 0)
              const completionRate = adminTotal > 0 ? (admin.encerrado / adminTotal) * 100 : 0
              const share = total > 0 ? (adminTotal / total) * 100 : 0
              return (
                <tr key={admin.adminId} className="hover:bg-muted/20">
                  <td className="px-4 py-3 text-muted-foreground">#{index + 1}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar src={admin.avatar_url} nome={admin.nome} size="sm" /><div><p className="font-medium">{admin.nome}</p><p className="text-xs text-muted-foreground">{share.toFixed(1)}% dos pedidos</p></div></div></td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">{fmtCount(admin.em_aberto)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{fmtCount(admin.encerrado)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{completionRate.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtCount(admin.indeterminado ?? 0)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtCurrency(admin.valor_total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

interface PedidosPanelProps {
  isGestor: boolean
  initialFilters: PedidosWorkspaceFilters
  initialTab: PedidosSubaba
}

export function PedidosPanel({ isGestor, initialFilters, initialTab }: PedidosPanelProps) {
  const [subaba, setSubaba] = useState<PedidosSubaba>(initialTab)
  const [selectedPedido, setSelectedPedido] = useState<PedidoCompra | null>(null)
  const { filters, setFilters, searchInput, setSearchInput, searchInputRef, resetFilters } = usePedidosFilters({ initialFilters })
  const workspace = usePedidosData({ filters })
  const summary = usePedidosSummary(filters)

  const sortedAdmins = useMemo(() => {
    const rows = summary.data?.admins ?? []
    return rows
      .filter((admin) => filters.adminId === 'all' || admin.adminId === filters.adminId)
      .slice()
      .sort((a, b) => b.em_aberto - a.em_aberto || b.valor_total - a.valor_total || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [filters.adminId, summary.data?.admins])
  const filterAdmins = useMemo(() => {
    const byId = new Map(workspace.availableAdmins.map((admin) => [admin.id, admin]))
    for (const admin of summary.data?.admins ?? []) {
      if (admin.responsavelAtualId && !byId.has(admin.responsavelAtualId)) {
        byId.set(admin.responsavelAtualId, {
          id: admin.responsavelAtualId,
          nome: admin.nome,
          avatar_url: admin.avatar_url,
        })
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [summary.data?.admins, workspace.availableAdmins])

  const freshness = workspace.contract?.freshness
  const quality = workspace.contract?.quality
  const qualityIssues = quality
    ? quality.indeterminados + quality.semItens + quality.semCriadorMapeado + quality.semResponsavel + quality.statusDesconhecido
    : 0
  const activeFilterCount = [filters.q, filters.status !== 'all', filters.adminId !== 'all', filters.anoExtracao, filters.mesExtracao].filter(Boolean).length
  const avatarByAdmin = new Map(filterAdmins.map((admin) => [admin.id, admin.avatar_url]))

  function handleSubaba(next: PedidosSubaba) {
    setSubaba(next)
    changeViewInUrl(next)
  }

  const header = (
    <>
      <PageTitleBlock
        title="Pedidos de compra"
        subtitle="Visão operacional do grupo de compradores 112. Período, aging e recortes usam a data do documento."
        rightSlot={(
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Grupo 112</Badge>
            <Badge variant={freshness?.stale ? 'destructive' : 'outline'}>{fmtFreshness(freshness?.asOf ?? workspace.kpis.ultima_atualizacao)}</Badge>
          </div>
        )}
      />
      <PedidosSubabaToggle value={subaba} onChange={handleSubaba} />
    </>
  )

  if (subaba === 'corretivas' || subaba === 'preventivas_anuais') {
    return (
      <div className="space-y-5">
        {header}
        <FornecedoresCarteiraPanel isGestor={isGestor} tipoCarteira={subaba === 'corretivas' ? 'corretiva' : 'preventiva_anual'} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {header}

      <PedidosKpiStrip
        kpis={workspace.kpis}
        loading={workspace.loadingInitial}
        activeStatus={filters.status}
        onStatusChange={(status) => setFilters((previous) => ({ ...previous, status }))}
      />

      {qualityIssues > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p><span className="font-semibold">Qualidade do recorte:</span> {fmtCount(qualityIssues)} ocorrência{qualityIssues === 1 ? '' : 's'} exigem validação entre status, itens ou responsabilidade.</p></div>
          {(quality?.indeterminados ?? 0) > 0 && <Button size="sm" variant="outline" onClick={() => setFilters((previous) => ({ ...previous, status: 'indeterminado' }))}>Revisar status</Button>}
        </div>
      )}

      <Card className="border-border/70">
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchInputRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar pedido, fornecedor, tipo ou criador SAP…" className="h-9 pl-9 pr-9" />
              {searchInput && <button type="button" onClick={() => setSearchInput('')} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
              <Select value={filters.status} onValueChange={(value) => setFilters((previous) => ({ ...previous, status: value as PedidoCompraStatusEfetivo | 'all' }))}>
                <SelectTrigger className="h-9 min-w-0 xl:w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              {isGestor && filterAdmins.length > 0 && (
                <Select value={filters.adminId} onValueChange={(adminId) => setFilters((previous) => ({ ...previous, adminId }))}>
                  <SelectTrigger className="h-9 min-w-0 xl:w-[190px]"><SelectValue placeholder="Responsável" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Todos os responsáveis</SelectItem>{filterAdmins.map((admin) => <SelectItem key={admin.id} value={admin.id}>{admin.nome}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Select value={filters.anoExtracao ?? 'all'} onValueChange={(year) => setFilters((previous) => ({ ...previous, anoExtracao: year === 'all' ? null : year, mesExtracao: null }))}>
                <SelectTrigger className="h-9 min-w-0 xl:w-[125px]"><SelectValue placeholder="Ano" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Todos os anos</SelectItem>{workspace.availableAnos.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.mesExtracao ?? 'all'} onValueChange={(month) => setFilters((previous) => ({ ...previous, mesExtracao: month === 'all' ? null : month }))}>
                <SelectTrigger className="h-9 min-w-0 xl:w-[135px]"><SelectValue placeholder="Mês" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Todos os meses</SelectItem>{workspace.availableMeses.map((month) => <SelectItem key={month} value={month}>{month.slice(4, 6)}/{month.slice(0, 4)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {activeFilterCount > 0 && <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={resetFilters}><SlidersHorizontal className="mr-1.5 h-4 w-4" /> Limpar ({activeFilterCount})</Button>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Período baseado em data do documento · pressione / para buscar</p>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div><CardTitle className="text-base">Pedidos do recorte</CardTitle><p className="mt-1 text-xs text-muted-foreground">Lista direta; selecione um pedido para conferir responsabilidade, valores e itens.</p></div>
          {!workspace.loadingInitial && <Badge variant="outline" className="shrink-0">{workspace.isFetching && !workspace.isFetchingNextPage ? 'Atualizando…' : `${fmtCount(workspace.rows.length)} carregados`}</Badge>}
        </CardHeader>
        <CardContent className="pt-0">
          {workspace.loadingInitial ? <WorkspaceSkeleton /> : workspace.error ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" /><div><p className="font-semibold text-destructive">Não foi possível carregar os pedidos</p><p className="mt-1 text-sm text-muted-foreground">{workspace.error}</p></div><Button variant="outline" size="sm" onClick={() => void workspace.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" /> Tentar novamente</Button>
            </div>
          ) : workspace.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-12 text-center"><p className="font-medium">Nenhum pedido encontrado</p><p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros ou limpe o recorte atual.</p>{activeFilterCount > 0 && <Button variant="outline" size="sm" className="mt-4" onClick={resetFilters}>Limpar filtros</Button>}</div>
          ) : (
            <div className="space-y-2">
              {workspace.rows.map((pedido) => <PedidoRow key={pedido.id} pedido={pedido} adminNome={pedido.responsavel_atual_nome ?? undefined} adminAvatarUrl={pedido.responsavel_atual_id ? avatarByAdmin.get(pedido.responsavel_atual_id) : null} onOpen={setSelectedPedido} />)}
              {workspace.hasNextPage && <div className="pt-3 text-center"><Button variant="outline" onClick={() => void workspace.fetchNextPage()} disabled={workspace.isFetchingNextPage}>{workspace.isFetchingNextPage ? 'Carregando…' : 'Carregar mais pedidos'}</Button></div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2"><CardTitle className="text-base">Carga por responsável</CardTitle><p className="text-xs text-muted-foreground">Ranking real por pedidos em aberto; responsabilidade atual não é o mesmo que criador SAP ou dono da carteira.</p></CardHeader>
        <CardContent className="p-0">
          {summary.isPending ? <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14" />)}</div> : summary.error ? (
            <div className="flex items-center justify-between gap-3 p-4 text-sm"><span className="text-destructive">{summary.error instanceof Error ? summary.error.message : 'Falha ao carregar o resumo.'}</span><Button variant="outline" size="sm" onClick={() => void summary.refetch()}>Tentar novamente</Button></div>
          ) : <ResponsaveisSummary admins={sortedAdmins} total={workspace.kpis.total} />}
        </CardContent>
      </Card>

      <PedidoDetailDrawer open={selectedPedido !== null} onOpenChange={(open) => { if (!open) setSelectedPedido(null) }} pedido={selectedPedido} adminNome={selectedPedido?.responsavel_atual_nome ?? undefined} />
    </div>
  )
}
