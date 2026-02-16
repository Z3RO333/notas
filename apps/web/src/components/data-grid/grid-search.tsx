'use client'

import type { RefObject } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface GridSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputRef?: RefObject<HTMLInputElement | null>
}

export function GridSearch({
  value,
  onChange,
  placeholder = 'Buscar...',
  inputRef,
}: GridSearchProps) {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-9 pr-8"
        placeholder={placeholder}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Limpar busca"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
