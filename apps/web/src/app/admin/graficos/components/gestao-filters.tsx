'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MES_NOMES: Record<string, string> = {
  '1': 'Janeiro', '2': 'Fevereiro', '3': 'Março', '4': 'Abril',
  '5': 'Maio', '6': 'Junho', '7': 'Julho', '8': 'Agosto',
  '9': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
}

interface GestaoFiltersProps {
  tiposOrdem: string[]
  anos: number[]
  anoAtivo?: number
  mesAtivo?: number
  tipoOrdemAtivo?: string
}

export function GestaoFilters({ tiposOrdem, anos, anoAtivo, mesAtivo, tipoOrdemAtivo }: GestaoFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value && value !== 'todos') {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <span className="text-sm font-medium text-muted-foreground">Filtros:</span>

      {/* Ano */}
      <Select
        value={anoAtivo ? String(anoAtivo) : 'todos'}
        onValueChange={(v) => updateParam('ano', v)}
      >
        <SelectTrigger className="w-28">
          <SelectValue placeholder="Ano" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos anos</SelectItem>
          {anos.map((a) => (
            <SelectItem key={a} value={String(a)}>{a}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Mês */}
      <Select
        value={mesAtivo ? String(mesAtivo) : 'todos'}
        onValueChange={(v) => updateParam('mes', v)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="Mês" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos meses</SelectItem>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <SelectItem key={m} value={String(m)}>{MES_NOMES[String(m)]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Tipo de Ordem */}
      {tiposOrdem.length > 0 && (
        <Select
          value={tipoOrdemAtivo ?? 'todos'}
          onValueChange={(v) => updateParam('tipo_ordem', v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos tipos</SelectItem>
            {tiposOrdem.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
