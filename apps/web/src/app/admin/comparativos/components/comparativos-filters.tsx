'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ComparativoTipoOrdemFilter } from '../comparativos-utils'

const triggerClassName = 'h-9 rounded-full border-border/70 bg-background/70 px-3 shadow-none'

interface ComparativosFiltersProps {
  anos: number[]
  anoBase: number
  anoComparado: number
  tipoOrdem: ComparativoTipoOrdemFilter
}

export function ComparativosFilters({
  anos,
  anoBase,
  anoComparado,
  tipoOrdem,
}: ComparativosFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const anoOptions = useMemo(
    () => Array.from(new Set([anoBase, anoComparado, ...anos])).sort((left, right) => right - left),
    [anoBase, anoComparado, anos],
  )

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === 'todos') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }

    if ('ano_base' in changes || 'ano_comparado' in changes || 'tipo_ordem' in changes) {
      params.delete('fornecedor')
    }

    router.replace(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card/60 p-3 sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Comparacao
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(anoBase)}
          onValueChange={(value) => updateParams({ ano_base: value })}
        >
          <SelectTrigger className={`${triggerClassName} w-36`} aria-label="Ano base">
            <SelectValue placeholder="Ano base" />
          </SelectTrigger>
          <SelectContent>
            {anoOptions.map((ano) => (
              <SelectItem key={`base-${ano}`} value={String(ano)} disabled={ano === anoComparado}>
                Base: {ano}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={String(anoComparado)}
          onValueChange={(value) => updateParams({ ano_comparado: value })}
        >
          <SelectTrigger className={`${triggerClassName} w-40`} aria-label="Ano comparado">
            <SelectValue placeholder="Ano comparado" />
          </SelectTrigger>
          <SelectContent>
            {anoOptions.map((ano) => (
              <SelectItem key={`comparado-${ano}`} value={String(ano)} disabled={ano === anoBase}>
                Comparado: {ano}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={tipoOrdem}
          onValueChange={(value) => updateParams({ tipo_ordem: value === 'todos' ? null : value })}
        >
          <SelectTrigger className={`${triggerClassName} w-36`} aria-label="Tipo de ordem">
            <SelectValue placeholder="Tipo de ordem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="PMOS">PMOS</SelectItem>
            <SelectItem value="PMPL">PMPL</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
