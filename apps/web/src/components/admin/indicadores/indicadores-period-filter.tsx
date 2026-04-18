'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface IndicadoresPeriodFilterProps {
  startValue: string
  endValue: string
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function IndicadoresPeriodFilter({ startValue, endValue }: IndicadoresPeriodFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const replaceParams = useCallback((nextParams: URLSearchParams) => {
    const query = nextParams.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router])

  const updateParam = useCallback((key: 'start' | 'end', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set(key, value)
    replaceParams(params)
  }, [replaceParams, searchParams])

  const resetToCurrentMonth = useCallback(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const params = new URLSearchParams(searchParams.toString())
    params.set('start', toDateInputValue(start))
    params.set('end', toDateInputValue(end))
    replaceParams(params)
  }, [replaceParams, searchParams])

  return (
    <div className="w-full rounded-2xl border border-border/60 bg-background/80 p-3 shadow-sm sm:w-auto sm:min-w-[340px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Período analisado
            </p>
            <p className="text-xs text-muted-foreground">
              Atualiza os indicadores sem sair da pagina.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-border/70 px-3 text-xs"
            onClick={resetToCurrentMonth}
          >
            Mês atual
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Inicio
            </span>
            <input
              type="date"
              value={startValue}
              onChange={(event) => updateParam('start', event.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-none focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Data inicial"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Fim
            </span>
            <input
              type="date"
              value={endValue}
              onChange={(event) => updateParam('end', event.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-none focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Data final"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
