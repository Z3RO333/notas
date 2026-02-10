'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

export function StatusFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentStatus = searchParams.get('status') || 'todas'
  const currentSearch = searchParams.get('q') || ''

  function updateParams(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'todas') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="flex gap-3">
      <Input
        placeholder="Buscar nota ou descricao..."
        defaultValue={currentSearch}
        onChange={(e) => {
          // Debounce simples
          const value = e.target.value
          const timeout = setTimeout(() => updateParams('q', value), 300)
          return () => clearTimeout(timeout)
        }}
        className="w-64"
      />
      <Select value={currentStatus} onValueChange={(v) => updateParams('status', v)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Filtrar status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todas">Todas</SelectItem>
          <SelectItem value="nova">Nova</SelectItem>
          <SelectItem value="em_andamento">Em Andamento</SelectItem>
          <SelectItem value="encaminhada_fornecedor">Encaminhada</SelectItem>
          <SelectItem value="concluida">Concluida</SelectItem>
          <SelectItem value="cancelada">Cancelada</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
