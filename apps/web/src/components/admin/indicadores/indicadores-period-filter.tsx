'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

interface IndicadoresPeriodFilterProps {
  startValue: string   // YYYY-MM-DD
  endValue: string     // YYYY-MM-DD (último dia inclusivo)
}

export function IndicadoresPeriodFilter({ startValue, endValue }: IndicadoresPeriodFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: 'start' | 'end', value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set(key, value)
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Período:</span>
      <input
        type="date"
        value={startValue}
        onChange={(e) => updateParam('start', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Data inicial"
      />
      <span className="text-muted-foreground">até</span>
      <input
        type="date"
        value={endValue}
        onChange={(e) => updateParam('end', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Data final"
      />
    </div>
  )
}
