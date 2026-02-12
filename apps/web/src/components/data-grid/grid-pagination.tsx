'use client'

import { Button } from '@/components/ui/button'

interface GridPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (nextPage: number) => void
  onPageSizeChange?: (nextSize: number) => void
  pageSizeOptions?: number[]
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function GridPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: GridPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground sm:text-sm">
        Mostrando {formatCount(from)}-{formatCount(to)} de {formatCount(total)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <select
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs sm:text-sm"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={String(size)}>
                {size}/pag
              </option>
            ))}
          </select>
        )}

        <Button type="button" size="sm" variant="outline" disabled={!canPrev} onClick={() => onPageChange(page - 1)}>
          Anterior
        </Button>

        <span className="text-xs text-muted-foreground sm:text-sm">
          Pagina {page} de {totalPages}
        </span>

        <Button type="button" size="sm" variant="outline" disabled={!canNext} onClick={() => onPageChange(page + 1)}>
          Proxima
        </Button>
      </div>
    </div>
  )
}
