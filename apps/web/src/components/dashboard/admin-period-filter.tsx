'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { updateSearchParams } from '@/lib/grid/query'
import type { AdminPeriodPreset } from '@/lib/dashboard/period'

interface AdminPeriodFilterProps {
  periodPreset: AdminPeriodPreset
  startDate: string
  endDate: string
}

const PRESETS: Array<{ value: AdminPeriodPreset; label: string }> = [
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '180d', label: '180 dias' },
  { value: 'custom', label: 'Periodo custom' },
]

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  )
}

export function AdminPeriodFilter({
  periodPreset,
  startDate,
  endDate,
}: AdminPeriodFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [draftStartDate, setDraftStartDate] = useState(startDate)
  const [draftEndDate, setDraftEndDate] = useState(endDate)

  useEffect(() => {
    setDraftStartDate(startDate)
    setDraftEndDate(endDate)
  }, [startDate, endDate])

  const customRangeIsValid = useMemo(() => (
    isValidDateInput(draftStartDate)
    && isValidDateInput(draftEndDate)
    && draftStartDate <= draftEndDate
  ), [draftStartDate, draftEndDate])

  function replaceQuery(updates: Record<string, string | null | undefined>) {
    const next = updateSearchParams(new URLSearchParams(searchParams.toString()), updates)
    const queryString = next.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname)
  }

  function handlePresetClick(value: AdminPeriodPreset) {
    if (value === 'custom') {
      replaceQuery({
        periodPreset: 'custom',
        startDate: draftStartDate,
        endDate: draftEndDate,
        janela: null,
      })
      return
    }

    replaceQuery({
      periodPreset: value,
      startDate: null,
      endDate: null,
      janela: null,
    })
  }

  function handleApplyCustomRange() {
    if (!customRangeIsValid) return
    replaceQuery({
      periodPreset: 'custom',
      startDate: draftStartDate,
      endDate: draftEndDate,
      janela: null,
    })
  }

  return (
    <div className="flex flex-col gap-2 md:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => handlePresetClick(preset.value)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              periodPreset === preset.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {periodPreset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="h-9 rounded-md border px-3 text-xs"
            value={draftStartDate}
            onChange={(event) => setDraftStartDate(event.target.value)}
          />
          <input
            type="date"
            className="h-9 rounded-md border px-3 text-xs"
            value={draftEndDate}
            onChange={(event) => setDraftEndDate(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleApplyCustomRange}
            disabled={!customRangeIsValid}
          >
            Aplicar
          </Button>
        </div>
      )}
    </div>
  )
}
