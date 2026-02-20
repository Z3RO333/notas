'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateSearchParams } from '@/lib/grid/query'
import type { OrdersPeriodMode } from '@/lib/types/database'

interface OrdersPeriodFilterProps {
  periodMode: OrdersPeriodMode
  year: number
  month: number
  startDate: string
  endDate: string
}

const MONTH_OPTIONS = [
  { value: '1', label: 'Janeiro' },
  { value: '2', label: 'Fevereiro' },
  { value: '3', label: 'Março' },
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

export function OrdersPeriodFilter({
  periodMode,
  year,
  month,
  startDate,
  endDate,
}: OrdersPeriodFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentYear = new Date().getFullYear()

  const yearOptions = useMemo(() => {
    const years: number[] = []
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      years.push(y)
    }
    return years
  }, [currentYear])

  function replaceQuery(updates: Record<string, string | number | null | undefined>) {
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), updates)
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  function handlePeriodModeChange(value: string) {
    const nextMode = value === 'custom' ? 'custom' : 'month'
    if (nextMode === 'month') {
      replaceQuery({
        periodMode: 'month',
        year,
        month,
        startDate: null,
        endDate: null,
      })
      return
    }

    replaceQuery({
      periodMode: 'custom',
      startDate: startDate || null,
      endDate: endDate || null,
      year: null,
      month: null,
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={periodMode} onValueChange={handlePeriodModeChange}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="month">Ano e mês</SelectItem>
          <SelectItem value="custom">Período personalizado</SelectItem>
        </SelectContent>
      </Select>

      {periodMode === 'month' ? (
        <>
          <Select value={String(year)} onValueChange={(value) => replaceQuery({ year: value })}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(month)} onValueChange={(value) => replaceQuery({ month: value })}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : (
        <>
          <input
            type="date"
            className="h-10 rounded-md border px-3 text-sm"
            value={startDate}
            onChange={(event) => replaceQuery({ startDate: event.target.value || null })}
          />
          <input
            type="date"
            className="h-10 rounded-md border px-3 text-sm"
            value={endDate}
            onChange={(event) => replaceQuery({ endDate: event.target.value || null })}
          />
        </>
      )}
    </div>
  )
}
