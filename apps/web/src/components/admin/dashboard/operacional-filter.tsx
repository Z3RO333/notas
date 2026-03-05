'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { User } from 'lucide-react'

interface Operacional {
  codigo: string
  nome: string
}

interface OperacionalFilterProps {
  operacionais: Operacional[]
  selected: string | null
}

export function OperacionalFilter({ operacionais, selected }: OperacionalFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handleChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set('fornecedor', value)
      } else {
        params.delete('fornecedor')
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return (
    <div className="flex items-center gap-2">
      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
      <select
        value={selected ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Todos os operacionais</option>
        {operacionais.map((op) => (
          <option key={op.codigo} value={op.codigo}>
            {op.nome.split(' ').slice(0, 2).join(' ')}
          </option>
        ))}
      </select>
    </div>
  )
}
