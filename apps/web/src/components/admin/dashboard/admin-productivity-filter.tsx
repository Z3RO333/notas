'use client'

import { useCallback } from 'react'
import { CalendarDays, HardHat } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface AdminProductivityFilterProps {
  selectedYear: number
  selectedMonth: number
  yearOptions: number[]
  selectedEspecialidade?: string | null
}

const ESPECIALIDADE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'eletricista', label: 'Eletricista' },
  { value: 'mecanico_auto', label: 'Mec. Auto' },
]

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
  selectedEspecialidade,
}: AdminProductivityFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateQuery = useCallback(
    (nextYear: number, nextMonth: number, nextEspecialidade?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('ano', String(nextYear))
      params.set('mes', String(nextMonth))
      if (nextEspecialidade) {
        params.set('especialidade', nextEspecialidade)
      } else {
        params.delete('especialidade')
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [pathname, router, searchParams],
  )

  const activeEspecialidade = selectedEspecialidade ?? ''

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        Periodo
      </div>

      <select
        value={String(selectedYear)}
        onChange={(event) => updateQuery(Number(event.target.value), selectedMonth, selectedEspecialidade)}
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
        onChange={(event) => updateQuery(selectedYear, Number(event.target.value), selectedEspecialidade)}
        className={`${nativeSelectClassName} min-w-40`}
      >
        {MONTH_OPTIONS.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>

      <div className="mx-1 h-5 w-px bg-border/60" />

      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <HardHat className="h-4 w-4" />
        Operacional
      </div>

      <div className="flex items-center gap-1.5">
        {ESPECIALIDADE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => updateQuery(selectedYear, selectedMonth, opt.value || null)}
            className={`h-9 rounded-full border px-3 py-1 text-sm transition-colors ${
              activeEspecialidade === opt.value
                ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                : 'border-border/70 bg-background/70 text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
