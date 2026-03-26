'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { CalendarDays, User } from 'lucide-react'

interface Operacional {
  codigo: string
  nome: string
}

interface OperacionalFilterProps {
  operacionais: Operacional[]
  selectedFornecedor: string | null
  selectedYear: number
  selectedMonth: number | null
  yearOptions: number[]
}

const MONTH_OPTIONS = [
  { value: '1', label: 'Janeiro' },
  { value: '2', label: 'Fevereiro' },
  { value: '3', label: 'Marco' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Maio' },
  { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

const nativeSelectClassName =
  'h-9 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-sm shadow-none transition-colors focus:outline-none focus:ring-1 focus:ring-ring'

export function OperacionalFilter({
  operacionais,
  selectedFornecedor,
  selectedYear,
  selectedMonth,
  yearOptions,
}: OperacionalFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateQueryParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }

      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname)
    },
    [router, pathname, searchParams],
  )

  const handleFornecedorChange = useCallback(
    (value: string) => {
      updateQueryParam('fornecedor', value || null)
    },
    [updateQueryParam],
  )

  const handleYearChange = useCallback(
    (value: string) => {
      updateQueryParam('ano', value || null)
    },
    [updateQueryParam],
  )

  const handleMonthChange = useCallback(
    (value: string) => {
      updateQueryParam('mes', value || null)
    },
    [updateQueryParam],
  )

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <User className="h-4 w-4" />
        Operacao
      </div>

      <select
        value={selectedFornecedor ?? ''}
        onChange={(event) => handleFornecedorChange(event.target.value)}
        className={`${nativeSelectClassName} min-w-44`}
      >
        <option value="">Todos os operacionais</option>
        {operacionais.map((operacional) => (
          <option key={operacional.codigo} value={operacional.codigo}>
            {operacional.nome.split(' ').slice(0, 2).join(' ')}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        Periodo
      </div>

      <select
        value={String(selectedYear)}
        onChange={(event) => handleYearChange(event.target.value)}
        className={`${nativeSelectClassName} min-w-24`}
      >
        {yearOptions.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>

      <select
        value={selectedMonth ? String(selectedMonth) : ''}
        onChange={(event) => handleMonthChange(event.target.value)}
        className={`${nativeSelectClassName} min-w-40`}
      >
        <option value="">Todos os meses</option>
        {MONTH_OPTIONS.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </div>
  )
}
