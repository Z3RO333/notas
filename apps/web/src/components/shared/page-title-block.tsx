import type { ReactNode } from 'react'

interface PageTitleBlockProps {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageTitleBlock({ title, subtitle, rightSlot }: PageTitleBlockProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {rightSlot}
    </div>
  )
}
