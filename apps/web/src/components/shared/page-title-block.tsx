import type { ReactNode } from 'react'

interface PageTitleBlockProps {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageTitleBlock({ title, subtitle, rightSlot }: PageTitleBlockProps) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-3xl space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? (
          <p className="text-sm leading-5 text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </div>
  )
}
