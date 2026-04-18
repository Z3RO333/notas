'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { CalendarDays, User } from 'lucide-react'
import Image from 'next/image'

interface Operacional {
  codigo: string
  nome: string
  avatar_url?: string | null
  especialidade?: string | null
}

const ESPECIALIDADE_OPTIONS = [
  { value: 'eletricista', label: 'Eletricistas' },
  { value: 'mecanico_auto', label: 'Mecânicos de Auto' },
]

interface OperacionalFilterProps {
  operacionais: Operacional[]
  selectedFornecedor: string | null
  selectedEspecialidade: string | null
  selectedYear: number
  selectedMonth: number | null
  yearOptions: number[]
  supportsEspecialidade?: boolean
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

function getOperacionalShortLabel(operacional: Operacional): string {
  const nome = (operacional.nome ?? '').trim()
  if (!nome) return operacional.codigo
  return nome.split(/\s+/).slice(0, 2).join(' ')
}

export function OperacionalFilter({
  operacionais,
  selectedFornecedor,
  selectedEspecialidade,
  selectedYear,
  selectedMonth,
  yearOptions,
  supportsEspecialidade = true,
}: OperacionalFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const updateQueryParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }

      const query = params.toString()
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname)
      })
    },
    [pathname, router, searchParams, startTransition],
  )

  const handleFornecedorChange = useCallback(
    (value: string) => {
      updateQueryParams({ fornecedor: value || null })
    },
    [updateQueryParams],
  )

  const handleYearChange = useCallback(
    (value: string) => {
      updateQueryParams({ ano: value || null })
    },
    [updateQueryParams],
  )

  const handleEspecialidadeChange = useCallback(
    (value: string) => {
      updateQueryParams({
        especialidade: value || null,
        fornecedor: null,
      })
    },
    [updateQueryParams],
  )

  const handleMonthChange = useCallback(
    (value: string) => {
      updateQueryParams({ mes: value || null })
    },
    [updateQueryParams],
  )

  const visibleOperacionais = selectedEspecialidade
    ? operacionais.filter((o) => o.especialidade === selectedEspecialidade)
    : operacionais

  return (
    <div className={supportsEspecialidade
      ? 'grid gap-3 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)_minmax(10rem,0.6fr)_minmax(12rem,0.8fr)]'
      : 'grid gap-3 lg:grid-cols-[minmax(16rem,1.2fr)_minmax(10rem,0.6fr)_minmax(12rem,0.8fr)]'}>
      {supportsEspecialidade ? (
        <label className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Tipo
          </span>
          <select
            value={selectedEspecialidade ?? ''}
            onChange={(event) => handleEspecialidadeChange(event.target.value)}
            className={`${nativeSelectClassName} w-full min-w-0`}
            disabled={isPending}
          >
            <option value="">Todos os tipos</option>
            {ESPECIALIDADE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <User className="h-4 w-4" />
          Operação
        </span>
        <div className="flex items-center gap-2">
          {(() => {
            const selected = visibleOperacionais.find((o) => o.codigo === selectedFornecedor)
            return selected?.avatar_url ? (
              <Image
                src={selected.avatar_url}
                alt={selected.nome}
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            )
          })()}
          <select
            value={selectedFornecedor ?? ''}
            onChange={(event) => handleFornecedorChange(event.target.value)}
            className={`${nativeSelectClassName} w-full min-w-0`}
            disabled={isPending}
          >
            <option value="">Todos os operacionais</option>
            {visibleOperacionais.map((operacional) => (
              <option key={operacional.codigo} value={operacional.codigo}>
                {getOperacionalShortLabel(operacional)}
              </option>
            ))}
          </select>
        </div>
      </label>

      <label className="space-y-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          Ano
        </span>
        <select
          value={String(selectedYear)}
          onChange={(event) => handleYearChange(event.target.value)}
          className={`${nativeSelectClassName} w-full min-w-0`}
          disabled={isPending}
        >
          {yearOptions.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Mês
        </span>
        <select
          value={selectedMonth ? String(selectedMonth) : ''}
          onChange={(event) => handleMonthChange(event.target.value)}
          className={`${nativeSelectClassName} w-full min-w-0`}
          disabled={isPending}
        >
          <option value="">Todos os meses</option>
          {MONTH_OPTIONS.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
