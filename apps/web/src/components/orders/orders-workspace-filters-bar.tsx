'use client'

import { memo, useMemo } from 'react'
import { Copy, Download, Loader2, RefreshCcw } from 'lucide-react'
import { OperacionaisEmCampoDialog } from '@/components/orders/operacionais-em-campo-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { SmartSearchResolution } from '@/components/orders/use-orders-data'
import type { OrdersPeriodModeOperational, OrdersWorkspaceFilters } from '@/lib/types/database'

const MONTH_LABELS = [
  { value: 1, label: 'Janeiro' },
  { value: 2, label: 'Fevereiro' },
  { value: 3, label: 'Março' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Maio' },
  { value: 6, label: 'Junho' },
  { value: 7, label: 'Julho' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Setembro' },
  { value: 10, label: 'Outubro' },
  { value: 11, label: 'Novembro' },
  { value: 12, label: 'Dezembro' },
]

const DATE_PRESETS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mes', label: 'Mês atual' },
  { value: 'custom', label: 'Personalizado' },
] as const

const PERIOD_MODE_LABELS: Array<{ value: OrdersPeriodModeOperational; label: string }> = [
  { value: 'all', label: 'Todo histórico' },
  { value: 'year', label: 'Ano' },
  { value: 'year_month', label: 'Ano + mês' },
  { value: 'month', label: 'Mês (todos os anos)' },
  { value: 'range', label: 'Intervalo específico' },
]

const STATUS_OPTIONS = [
  { value: 'ativas', label: 'Ativas (padrão)' },
  { value: 'todas', label: 'Todo o histórico' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_tratativa', label: 'Em execução' },
  { value: 'em_avaliacao', label: 'Em avaliação' },
  { value: 'avaliadas', label: 'Avaliadas' },
  { value: 'nao_realizada', label: 'Não realizada' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'desconhecido', label: 'Desconhecido' },
]

const SEMAFORO_OPTIONS = [
  { value: 'amarelo', label: 'Atenção (3-6d)' },
  { value: 'vermelho', label: 'Atrasada (7+d)' },
]

const PRIORIDADE_OPTIONS = [{ value: 'todas', label: 'Todas prioridades' }, ...SEMAFORO_OPTIONS]

function utcYmd(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-')
}

function utcFirstOfMonth(): string {
  const d = new Date()
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), '01'].join('-')
}

function detectDatePreset(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return 'custom'
  const today = utcYmd(0)
  if (startDate === today && endDate === today) return 'hoje'
  if (startDate === utcYmd(1) && endDate === utcYmd(1)) return 'ontem'
  if (startDate === utcYmd(6) && endDate === today) return '7d'
  if (startDate === utcYmd(29) && endDate === today) return '30d'
  if (startDate === utcFirstOfMonth() && endDate === today) return 'mes'
  return 'custom'
}

function makeYearOptions(): number[] {
  const current = new Date().getUTCFullYear()
  return Array.from({ length: 12 }, (_, idx) => current - idx)
}

export interface OrdersWorkspaceFiltersBarProps {
  filters: OrdersWorkspaceFilters
  setFilters: React.Dispatch<React.SetStateAction<OrdersWorkspaceFilters>>
  searchInput: string
  setSearchInput: (value: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  allLoadedSelected: boolean
  onToggleSelectAllLoaded: () => void
  copyFilterLoading: boolean
  copyButtonLabel: string
  onCopyOrders: () => void
  copyUsesSelection: boolean
  loadingInitial: boolean
  rowsCount: number
  responsavelOptions: Array<{ value: string; label: string }>
  unitSelectOptions: Array<{ value: string; label: string }>
  smartSearch: SmartSearchResolution
  canViewGlobal: boolean
  onExport: () => void
  onRefresh: () => void
}

export const OrdersWorkspaceFiltersBar = memo(function OrdersWorkspaceFiltersBar({
  filters,
  setFilters,
  searchInput,
  setSearchInput,
  searchInputRef,
  onSearchKeyDown,
  allLoadedSelected,
  onToggleSelectAllLoaded,
  copyFilterLoading,
  copyButtonLabel,
  onCopyOrders,
  copyUsesSelection,
  loadingInitial,
  rowsCount,
  responsavelOptions,
  unitSelectOptions,
  smartSearch,
  canViewGlobal,
  onExport,
  onRefresh,
}: OrdersWorkspaceFiltersBarProps) {
  const years = useMemo(() => makeYearOptions(), [])

  const periodControlsClassName = cn(
    'grid gap-2 sm:grid-cols-2',
    filters.periodMode === 'range'
      ? 'xl:grid-cols-4'
      : filters.periodMode === 'year_month'
        ? 'xl:grid-cols-3'
        : filters.periodMode === 'all'
          ? 'xl:grid-cols-1'
          : 'xl:grid-cols-2',
  )

  function handleDatePreset(preset: string) {
    const today = utcYmd(0)
    const ranges: Record<string, { start: string; end: string }> = {
      hoje: { start: today, end: today },
      ontem: { start: utcYmd(1), end: utcYmd(1) },
      '7d': { start: utcYmd(6), end: today },
      '30d': { start: utcYmd(29), end: today },
      mes: { start: utcFirstOfMonth(), end: today },
    }
    const range = ranges[preset]
    if (range) {
      setFilters((prev) => ({ ...prev, periodMode: 'range', startDate: range.start, endDate: range.end }))
    }
  }

  return (
    <div className="sticky top-2 z-30 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="grid gap-3 xl:grid-cols-12 xl:items-start">
        <Input
          ref={searchInputRef}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Buscar por nota, ordem ou descrição"
          className="xl:col-span-3"
        />

        <div className={cn(periodControlsClassName, 'xl:col-span-5')}>
          <Select
            value={filters.periodMode}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, periodMode: value as OrdersPeriodModeOperational }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_MODE_LABELS.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filters.periodMode === 'year' && (
            <Select
              value={String(filters.year ?? years[0])}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {filters.periodMode === 'year_month' && (
            <>
              <Select
                value={String(filters.year ?? years[0])}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, year: Number(value) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(filters.month ?? 1)}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((month) => (
                    <SelectItem key={month.value} value={String(month.value)}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          {filters.periodMode === 'month' && (
            <Select
              value={String(filters.month ?? 1)}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, month: Number(value) }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((month) => (
                  <SelectItem key={month.value} value={String(month.value)}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {filters.periodMode === 'range' && (
            <>
              <Select
                value={detectDatePreset(filters.startDate ?? null, filters.endDate ?? null)}
                onValueChange={handleDatePreset}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Período rápido" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={filters.startDate ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value || null }))}
              />
              <Input
                type="date"
                value={filters.endDate ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value || null }))}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:col-span-4 xl:justify-end">
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground">
            <input type="checkbox" checked={allLoadedSelected} onChange={onToggleSelectAllLoaded} className="h-4 w-4" />
            Selecionar carregadas
          </label>
          <Button
            type="button"
            size="sm"
            className="justify-center"
            onClick={() => void onCopyOrders()}
            disabled={copyFilterLoading || (!copyUsesSelection && (loadingInitial || rowsCount === 0))}
          >
            {copyFilterLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            {copyButtonLabel}
          </Button>
          <OperacionaisEmCampoDialog />
          <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={rowsCount === 0}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Exportar planilha
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Select value={filters.status || 'ativas'} onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.prioridade || 'todas'}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, prioridade: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            {PRIORIDADE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canViewGlobal && (
          <Select
            value={filters.responsavel || 'todos'}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, responsavel: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os responsáveis</SelectItem>
              {responsavelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <SearchableSelect
          id="workspace-unidades"
          options={unitSelectOptions}
          value={filters.unidade}
          onValueChange={(value) => setFilters((prev) => ({ ...prev, unidade: value }))}
          placeholder="Unidade"
        />
      </div>

      {smartSearch.mode !== 'none' && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {smartSearch.mode === 'responsavel'
            ? `Busca inteligente ativa: responsável "${smartSearch.matchedOwnerLabel}".`
            : smartSearch.mode === 'ordem'
              ? 'Busca inteligente ativa: número longo priorizado como ORDEM.'
              : smartSearch.mode === 'nota'
                ? 'Busca inteligente ativa: número curto priorizado como NOTA.'
                : 'Busca inteligente ativa: texto em descrição e termos relacionados.'}
        </p>
      )}
    </div>
  )
})
