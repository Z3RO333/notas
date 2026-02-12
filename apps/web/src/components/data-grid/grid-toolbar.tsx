'use client'

import type { ReactNode } from 'react'

interface GridToolbarProps {
  children: ReactNode
}

export function GridToolbar({ children }: GridToolbarProps) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      {children}
    </div>
  )
}
