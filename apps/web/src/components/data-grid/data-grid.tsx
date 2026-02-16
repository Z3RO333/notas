'use client'

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { GridEmptyState } from '@/components/data-grid/grid-empty-state'
import { GridErrorState } from '@/components/data-grid/grid-error-state'
import { GridLoadingState } from '@/components/data-grid/grid-loading-state'

interface DataGridProps<TData> {
  data: TData[]
  columns: ColumnDef<TData, unknown>[]
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  getRowId?: (row: TData, index: number) => string
  loading?: boolean
  errorMessage?: string | null
  emptyMessage?: string
  density?: 'compact' | 'comfortable'
  rowClassName?: (row: TData) => string
}

export function DataGrid<TData>({
  data,
  columns,
  sorting = [],
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  getRowId,
  loading = false,
  errorMessage = null,
  emptyMessage,
  density = 'comfortable',
  rowClassName,
}: DataGridProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: Boolean(onSortingChange),
    enableRowSelection: Boolean(onRowSelectionChange),
    state: {
      sorting,
      rowSelection,
      columnVisibility,
    },
    onSortingChange,
    onRowSelectionChange,
    onColumnVisibilityChange,
    getRowId,
  })

  if (errorMessage) {
    return <GridErrorState message={errorMessage} />
  }

  if (loading) {
    return <GridLoadingState />
  }

  if (table.getRowModel().rows.length === 0) {
    return <GridEmptyState message={emptyMessage} />
  }

  const headerCellClass = density === 'compact'
    ? 'px-2 py-1.5 text-left font-medium text-muted-foreground'
    : 'px-3 py-2 text-left font-medium text-muted-foreground'
  const bodyCellClass = density === 'compact'
    ? 'px-2 py-1.5 align-top'
    : 'px-3 py-2 align-top'

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b bg-muted/40">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className={headerCellClass}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={`border-b last:border-b-0 hover:bg-muted/20 ${rowClassName ? rowClassName(row.original) : ''}`}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={bodyCellClass}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
