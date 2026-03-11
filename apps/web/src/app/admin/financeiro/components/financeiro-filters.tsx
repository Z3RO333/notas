'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MES_NOMES: Record<string, string> = {
  '1': 'Janeiro',
  '2': 'Fevereiro',
  '3': 'Marco',
  '4': 'Abril',
  '5': 'Maio',
  '6': 'Junho',
  '7': 'Julho',
  '8': 'Agosto',
  '9': 'Setembro',
  '10': 'Outubro',
  '11': 'Novembro',
  '12': 'Dezembro',
}

interface FinanceiroFiltersProps {
  anos: number[]
  anoAtivo?: number
  mesAtivo?: number
}

export function FinanceiroFilters({ anos, anoAtivo, mesAtivo }: FinanceiroFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value !== 'todos') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.replace(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-muted-foreground">Filtros:</span>

      <Select
        value={anoAtivo ? String(anoAtivo) : 'todos'}
        onValueChange={(value) => updateParam('ano', value)}
      >
        <SelectTrigger className="w-28">
          <SelectValue placeholder="Ano" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos anos</SelectItem>
          {anos.map((ano) => (
            <SelectItem key={ano} value={String(ano)}>
              {ano}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={mesAtivo ? String(mesAtivo) : 'todos'}
        onValueChange={(value) => updateParam('mes', value)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Mes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos meses</SelectItem>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((mes) => (
            <SelectItem key={mes} value={String(mes)}>
              {MES_NOMES[String(mes)]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
