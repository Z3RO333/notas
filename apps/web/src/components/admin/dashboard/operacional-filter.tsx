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
    [router, pathname, searchParams]
  )

  const handleFornecedorChange = useCallback(
    (value: string) => {
      updateQueryParam('fornecedor', value || null)
    },
    [updateQueryParam]
  )

  const handleYearChange = useCallback(
    (value: string) => {
      updateQueryParam('ano', value || null)
    },
    [updateQueryParam]
  )

  const handleMonthChange = useCallback(
    (value: string) => {
      updateQueryParam('mes', value || null)
    },
    [updateQueryParam]
  )

  return (
    <div className="flex items-center gap-2">
      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
      <select
        value={selectedFornecedor ?? ''}
        onChange={(event) => handleFornecedorChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Todos os operacionais</option>
        {operacionais.map((op) => (
          <option key={op.codigo} value={op.codigo}>
            {op.nome.split(' ').slice(0, 2).join(' ')}
          </option>
        ))}
      </select>

      <CalendarDays className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />

      <select
        value={String(selectedYear)}
        onChange={(event) => handleYearChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
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
        className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
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
