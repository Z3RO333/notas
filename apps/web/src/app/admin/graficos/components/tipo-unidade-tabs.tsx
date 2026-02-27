'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { GestaoSegmentoSummary } from '@/lib/types/database'

interface TipoUnidadeTabsProps {
  segmentos: GestaoSegmentoSummary[]
  tipoAtivo?: string
}

const TAB_ORDER = ['TODOS', 'LOJA', 'FARMA', 'CD'] as const
const TAB_LABELS: Record<string, string> = {
  TODOS: 'Todos',
  LOJA: 'Lojas',
  FARMA: 'Farmas',
  CD: 'CDs',
}

export function TipoUnidadeTabs({ segmentos, tipoAtivo }: TipoUnidadeTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleSelect(tipo: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (tipo === 'TODOS') {
      params.delete('tipo')
    } else {
      params.set('tipo', tipo.toLowerCase())
    }
    router.replace(`${pathname}?${params.toString()}`)
  }

  const tipoAtivoUpper = tipoAtivo ? tipoAtivo.toUpperCase() : 'TODOS'

  const segmentosMap = Object.fromEntries(segmentos.map((s) => [s.tipo, s]))

  return (
    <div className="flex gap-1 border-b pb-px">
      {TAB_ORDER.map((tipo) => {
        const isActive = tipoAtivoUpper === tipo
        const seg = tipo !== 'TODOS' ? segmentosMap[tipo] : null

        return (
          <button
            key={tipo}
            onClick={() => handleSelect(tipo)}
            className={cn(
              'flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors border-b-2',
              isActive
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            {TAB_LABELS[tipo]}
            {seg && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {seg.total_ordens.toLocaleString('pt-BR')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
