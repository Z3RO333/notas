import { describe, expect, it } from 'vitest'
import type {
  ComparativoFornecedorMes,
  ComparativoFornecedorResumo,
  ComparativoOrdensMes,
} from '@/lib/types/database'
import {
  buildDelta,
  buildOrdersChartRows,
  buildSupplierAnnualRows,
  buildSupplierMonthlyRows,
  filterSupplierAnnualRows,
  formatDeltaPercent,
  resolveComparativoYears,
  resolveSelectedSupplierRef,
  sortSupplierAnnualRows,
} from './comparativos-utils'

describe('comparativos-utils', () => {
  it('resolves the two newest available years by default', () => {
    const result = resolveComparativoYears({
      rawYears: [2024, 2026, 2025],
      nowYear: 2026,
    })

    expect(result.availableYears).toEqual([2026, 2025, 2024])
    expect(result.anoComparado).toBe(2026)
    expect(result.anoBase).toBe(2025)
  })

  it('falls back to previous calendar year when only one year exists', () => {
    const result = resolveComparativoYears({
      rawYears: [2026],
      nowYear: 2026,
    })

    expect(result.availableYears).toEqual([2026])
    expect(result.anoComparado).toBe(2026)
    expect(result.anoBase).toBe(2025)
  })

  it('treats zero base with positive comparison as no percent base', () => {
    expect(buildDelta(0, 25)).toEqual({ deltaAbs: 25, deltaPct: null })
    expect(buildDelta(0, 0)).toEqual({ deltaAbs: 0, deltaPct: 0 })
    expect(formatDeltaPercent(null)).toBe('Sem base')
  })

  it('keeps Jan-Dec aligned and fills missing months with zero', () => {
    const rows: ComparativoOrdensMes[] = [
      { ano: 2025, mes: 1, total_ordens: 10, ordens_abertas: 4, ordens_executadas: 6 },
      { ano: 2026, mes: 1, total_ordens: 12, ordens_abertas: 3, ordens_executadas: 9 },
      { ano: 2026, mes: 3, total_ordens: 7, ordens_abertas: 2, ordens_executadas: 5 },
    ]

    const chartRows = buildOrdersChartRows(rows, 2025, 2026, 'total_ordens')

    expect(chartRows).toHaveLength(12)
    expect(chartRows[0]).toMatchObject({ label: 'Jan', valorBase: 10, valorComparado: 12 })
    expect(chartRows[1]).toMatchObject({ label: 'Fev', valorBase: 0, valorComparado: 0 })
    expect(chartRows[2]).toMatchObject({ label: 'Mar', valorBase: 0, valorComparado: 7 })
  })

  it('combines annual supplier rows from both years and computes delta', () => {
    const rows: ComparativoFornecedorResumo[] = [
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2025,
        total_ordens: 8,
        total_gasto: 1000,
        valor_realizado: 800,
        valor_previsto_pendente: 200,
      },
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2026,
        total_ordens: 10,
        total_gasto: 1400,
        valor_realizado: 1000,
        valor_previsto_pendente: 400,
      },
      {
        fornecedor_ref: '__nome__:sem fornecedor',
        fornecedor_codigo: null,
        fornecedor_nome: 'Sem fornecedor',
        ano: 2026,
        total_ordens: 1,
        total_gasto: 50,
        valor_realizado: 50,
        valor_previsto_pendente: 0,
      },
    ]

    const combined = buildSupplierAnnualRows(rows, 2025, 2026)

    expect(combined[0]).toMatchObject({
      fornecedorRef: '100',
      totalBase: 1000,
      totalComparado: 1400,
      deltaAbs: 400,
    })
    expect(combined[0].deltaPct).toBeCloseTo(40)
    expect(combined[1]).toMatchObject({
      fornecedorRef: '__nome__:sem fornecedor',
      totalBase: 0,
      totalComparado: 50,
      deltaAbs: 50,
      deltaPct: null,
    })
  })

  it('builds monthly supplier detail and appends a total row', () => {
    const rows: ComparativoFornecedorMes[] = [
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2025,
        mes: 1,
        total_ordens: 2,
        total_gasto: 200,
        valor_realizado: 150,
        valor_previsto_pendente: 50,
      },
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2026,
        mes: 1,
        total_ordens: 3,
        total_gasto: 350,
        valor_realizado: 350,
        valor_previsto_pendente: 0,
      },
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2026,
        mes: 2,
        total_ordens: 1,
        total_gasto: 100,
        valor_realizado: 80,
        valor_previsto_pendente: 20,
      },
    ]

    const detail = buildSupplierMonthlyRows(rows, 2025, 2026)

    expect(detail).toHaveLength(13)
    expect(detail[0]).toMatchObject({
      label: 'Jan',
      totalBase: 200,
      totalComparado: 350,
      deltaAbs: 150,
    })
    expect(detail[1]).toMatchObject({
      label: 'Fev',
      totalBase: 0,
      totalComparado: 100,
      deltaPct: null,
    })
    expect(detail[12]).toMatchObject({
      key: 'total',
      label: 'Total',
      totalBase: 200,
      totalComparado: 450,
      deltaAbs: 250,
    })
  })

  it('filters, sorts and resolves the selected supplier safely', () => {
    const rows = buildSupplierAnnualRows([
      {
        fornecedor_ref: '200',
        fornecedor_codigo: '200',
        fornecedor_nome: 'Fornecedor B',
        ano: 2026,
        total_ordens: 2,
        total_gasto: 100,
        valor_realizado: 100,
        valor_previsto_pendente: 0,
      },
      {
        fornecedor_ref: '100',
        fornecedor_codigo: '100',
        fornecedor_nome: 'Fornecedor A',
        ano: 2026,
        total_ordens: 3,
        total_gasto: 300,
        valor_realizado: 300,
        valor_previsto_pendente: 0,
      },
    ], 2025, 2026)

    const filtered = filterSupplierAnnualRows(rows, 'fornecedor a')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.fornecedorRef).toBe('100')

    const sorted = sortSupplierAnnualRows(rows, 'nome', 'asc')
    expect(sorted.map((row) => row.fornecedorRef)).toEqual(['100', '200'])

    expect(resolveSelectedSupplierRef(rows, '200')).toBe('200')
    expect(resolveSelectedSupplierRef(rows, '999')).toBe('100')
  })
})
