'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { CalendarDays, ChevronDown, HardHat, SlidersHorizontal } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ALL_PRODUCTIVITY_MONTHS_PARAM } from '@/lib/dashboard/productivity-month'
import { cn } from '@/lib/utils'

interface AdminProductivityFilterProps {
  selectedYear: number
  selectedMonth: number | null
  yearOptions: number[]
  selectedEspecialidade?: string | null
}

const ESPECIALIDADE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'eletricista', label: 'Eletricista' },
  { value: 'mecanico_auto', label: 'Mec. Auto' },
]

const MONTH_OPTIONS = [
  { value: ALL_PRODUCTIVITY_MONTHS_PARAM, label: 'Todos os meses (total)' },
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
  'h-11 w-full rounded-2xl border border-border/70 bg-background/80 px-4 text-sm shadow-none transition-colors focus:outline-none focus:ring-1 focus:ring-ring'

export function AdminProductivityFilter({
  selectedYear,
  selectedMonth,
  yearOptions,
  selectedEspecialidade,
}: AdminProductivityFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const updateQuery = useCallback(
    (nextYear: number, nextMonth: number | null, nextEspecialidade?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('ano', String(nextYear))
      if (nextMonth === null) {
        params.set('mes', ALL_PRODUCTIVITY_MONTHS_PARAM)
      } else {
        params.set('mes', String(nextMonth))
      }
      if (nextEspecialidade) {
        params.set('especialidade', nextEspecialidade)
      } else {
        params.delete('especialidade')
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`)
      })
    },
    [pathname, router, searchParams, startTransition],
  )

  const activeEspecialidade = selectedEspecialidade ?? ''
  const selectedPeriodLabel = useMemo(
    () => (selectedMonth === null
      ? `Ano ${selectedYear}`
      : (MONTH_OPTIONS.find((month) => month.value === String(selectedMonth))?.label ?? 'Mes atual')),
    [selectedMonth, selectedYear],
  )
  const selectedEspecialidadeLabel = useMemo(
    () => ESPECIALIDADE_OPTIONS.find((option) => option.value === activeEspecialidade)?.label ?? 'Todos',
    [activeEspecialidade],
  )

  return (
    <section
      className="rounded-[1.75rem] border border-border/70 bg-card/75 px-3 py-3 shadow-sm supports-[backdrop-filter]:bg-card/65 md:px-4"
      aria-busy={isPending}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-muted/20"
        aria-expanded={isOpen}
        disabled={isPending}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros do painel
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-sm text-foreground">
              {selectedPeriodLabel}
            </span>
            <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              {selectedEspecialidadeLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">
            {isPending ? 'Atualizando...' : isOpen ? 'Recolher' : 'Expandir'}
          </span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {isOpen ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="max-h-[70vh] overflow-y-auto pr-1 xl:max-h-none xl:overflow-visible">
            <div className="grid gap-4 xl:grid-cols-[220px_260px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  Ano
                </div>
                <select
                  aria-label="Ano"
                  value={String(selectedYear)}
                  onChange={(event) => updateQuery(Number(event.target.value), selectedMonth, selectedEspecialidade)}
                  className={nativeSelectClassName}
                  disabled={isPending}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  Mes
                </div>
                <select
                  aria-label="Mes"
                  value={selectedMonth === null ? ALL_PRODUCTIVITY_MONTHS_PARAM : String(selectedMonth)}
                  onChange={(event) => updateQuery(
                    selectedYear,
                    event.target.value === ALL_PRODUCTIVITY_MONTHS_PARAM ? null : Number(event.target.value),
                    selectedEspecialidade,
                  )}
                  className={nativeSelectClassName}
                  disabled={isPending}
                >
                  {MONTH_OPTIONS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <HardHat className="h-4 w-4" />
                  Foco operacional
                </div>
                <div className="flex flex-wrap gap-2">
                  {ESPECIALIDADE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateQuery(selectedYear, selectedMonth, opt.value || null)}
                      disabled={isPending}
                      className={cn(
                        'h-10 rounded-full border px-4 text-sm transition-colors',
                        activeEspecialidade === opt.value
                          ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                          : 'border-border/70 bg-background/70 text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
