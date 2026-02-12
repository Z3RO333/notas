'use client'

import type { RefObject } from 'react'
import { Search } from 'lucide-react'
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
        className="pl-9"
        placeholder={placeholder}
      />
    </div>
  )
}
