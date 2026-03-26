import type { ReactNode } from 'react'

interface PageTitleBlockProps {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageTitleBlock({ title, subtitle, rightSlot }: PageTitleBlockProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? (
          <p className="text-sm leading-6 text-muted-foreground sm:text-[15px]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </div>
  )
}
