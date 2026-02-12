'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface GridFilterOption {
  value: string
  label: string
}

interface GridFiltersProps {
  label: string
  value: string
  options: GridFilterOption[]
  onChange: (value: string) => void
  className?: string
}

export function GridFilters({ label, value, options, onChange, className }: GridFiltersProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-full xl:w-48'}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
