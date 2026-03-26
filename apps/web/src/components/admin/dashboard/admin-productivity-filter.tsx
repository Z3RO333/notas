'use client'

import { useCallback } from 'react'
import { CalendarDays } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface AdminProductivityFilterProps {
  selectedYear: number
  selectedMonth: number
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

export function AdminProductivityFilter({
  selectedYear,
  selectedMonth,
  yearOptions,
}: AdminProductivityFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateQuery = useCallback(
    (nextYear: number, nextMonth: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('ano', String(nextYear))
      params.set('mes', String(nextMonth))
      router.push(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams],
  )

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        Periodo
      </div>

      <select
        value={String(selectedYear)}
        onChange={(event) => updateQuery(Number(event.target.value), selectedMonth)}
        className={`${nativeSelectClassName} min-w-24`}
      >
        {yearOptions.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>

      <select
        value={String(selectedMonth)}
        onChange={(event) => updateQuery(selectedYear, Number(event.target.value))}
        className={`${nativeSelectClassName} min-w-40`}
      >
        {MONTH_OPTIONS.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </div>
  )
}
