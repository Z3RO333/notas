'use client'

import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ColumnVisibilityItem {
  id: string
  label: string
  visible: boolean
}

interface GridColumnVisibilityProps {
  columns: ColumnVisibilityItem[]
  onToggle: (id: string, nextVisible: boolean) => void
}

export function GridColumnVisibility({ columns, onToggle }: GridColumnVisibilityProps) {
  return (
    <details className="relative">
      <summary className="list-none">
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <Settings2 className="h-4 w-4" />
          Colunas
        </Button>
      </summary>

      <div className="absolute right-0 z-20 mt-2 w-52 rounded-md border bg-background p-2 shadow-md">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Colunas visiveis</p>
        <div className="space-y-1">
          {columns.map((column) => (
            <label key={column.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40">
              <input
                type="checkbox"
                checked={column.visible}
                onChange={(event) => onToggle(column.id, event.target.checked)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  )
}
