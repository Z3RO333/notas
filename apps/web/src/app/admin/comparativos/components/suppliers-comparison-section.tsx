'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatCurrencyBRL } from '@/app/admin/financeiro/financeiro-format'
import type { ComparativoFornecedorMes } from '@/lib/types/database'
import {
  buildSupplierMonthlyRows,
  filterSupplierAnnualRows,
  formatDeltaPercent,
  sortSupplierAnnualRows,
  type SupplierAnnualComparisonRow,
  type SupplierMonthlyComparisonRow,
  type SupplierSortDirection,
  type SupplierSortKey,
} from '../comparativos-utils'
import { SupplierMonthlyChart } from './supplier-monthly-chart'

interface SuppliersComparisonSectionProps {
  annualRows: SupplierAnnualComparisonRow[]
  monthlyRows: ComparativoFornecedorMes[]
  selectedSupplierRef: string | null
  anoBase: number
  anoComparado: number
}

function formatSupplierLabel(row: SupplierAnnualComparisonRow): string {
  if (!row.fornecedorCodigo) return row.fornecedorNome
  return `${row.fornecedorNome} (${row.fornecedorCodigo})`
}

function SortIndicator({ active, direction }: { active: boolean; direction: SupplierSortDirection }) {
  if (!active) return null
  return direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
}

function SupplierDetailTable({
  rows,
  anoBase,
  anoComparado,
}: {
  rows: SupplierMonthlyComparisonRow[]
  anoBase: number
  anoComparado: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Detalhe mensal</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Mes</th>
                <th className="px-4 py-3 text-right font-medium">{anoBase}</th>
                <th className="px-4 py-3 text-right font-medium">{anoComparado}</th>
                <th className="px-4 py-3 text-right font-medium">Delta</th>
                <th className="px-4 py-3 text-right font-medium">Delta %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.totalBase)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.totalComparado)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.deltaAbs)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDeltaPercent(row.deltaPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function SuppliersComparisonSection({
  annualRows,
  monthlyRows,
  selectedSupplierRef,
  anoBase,
  anoComparado,
}: SuppliersComparisonSectionProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SupplierSortKey>('total_comparado')
  const [sortDirection, setSortDirection] = useState<SupplierSortDirection>('desc')

  const filteredRows = useMemo(
    () => filterSupplierAnnualRows(annualRows, query),
    [annualRows, query],
  )
  const sortedRows = useMemo(
    () => sortSupplierAnnualRows(filteredRows, sortKey, sortDirection),
    [filteredRows, sortDirection, sortKey],
  )
  const selectedRow = annualRows.find((row) => row.fornecedorRef === selectedSupplierRef) ?? null
  const detailRows = useMemo(
    () => buildSupplierMonthlyRows(monthlyRows, anoBase, anoComparado),
    [anoBase, anoComparado, monthlyRows],
  )

  function setSelectedSupplier(nextSupplierRef: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (nextSupplierRef) {
      params.set('fornecedor', nextSupplierRef)
    } else {
      params.delete('fornecedor')
    }
    router.replace(`${pathname}?${params.toString()}`)
  }

  function toggleSort(nextKey: SupplierSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(nextKey)
    setSortDirection(nextKey === 'nome' ? 'asc' : 'desc')
  }

  if (annualRows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fornecedores</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum fornecedor encontrado para os anos selecionados.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Fornecedores - acumulado anual</CardTitle>
            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar fornecedor"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('nome')}>
                      Fornecedor
                      <SortIndicator active={sortKey === 'nome'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('total_base')}>
                      {anoBase}
                      <SortIndicator active={sortKey === 'total_base'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('total_comparado')}>
                      {anoComparado}
                      <SortIndicator active={sortKey === 'total_comparado'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('delta_abs')}>
                      Delta
                      <SortIndicator active={sortKey === 'delta_abs'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('delta_pct')}>
                      Delta %
                      <SortIndicator active={sortKey === 'delta_pct'} direction={sortDirection} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const active = row.fornecedorRef === selectedSupplierRef
                  return (
                    <tr
                      key={row.fornecedorRef}
                      className={`border-b transition-colors last:border-0 hover:bg-muted/20 ${active ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => setSelectedSupplier(row.fornecedorRef)}
                        >
                          <p className="font-medium">{row.fornecedorNome}</p>
                          {row.fornecedorCodigo && (
                            <p className="text-xs text-muted-foreground">{row.fornecedorCodigo}</p>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.totalBase)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.totalComparado)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrencyBRL(row.deltaAbs)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatDeltaPercent(row.deltaPct)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedRow ? (
        <div className="space-y-6">
          <div className="rounded-xl border bg-muted/10 p-4">
            <div>
              <h3 className="text-base font-semibold">{formatSupplierLabel(selectedRow)}</h3>
              <p className="text-sm text-muted-foreground">
                Comparativo mensal e acumulado anual do fornecedor em foco.
              </p>
            </div>
          </div>

          <SupplierMonthlyChart
            rows={detailRows}
            anoBase={anoBase}
            anoComparado={anoComparado}
            fornecedorNome={selectedRow.fornecedorNome}
          />

          <SupplierDetailTable rows={detailRows} anoBase={anoBase} anoComparado={anoComparado} />
        </div>
      ) : null}
    </section>
  )
}
