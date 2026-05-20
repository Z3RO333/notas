'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface DrawerDetalhesProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  title: string
  subtitle?: string
  children: ReactNode
}

export function DrawerDetalhes({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: DrawerDetalhesProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!left-auto !right-0 !top-0 flex h-dvh w-full max-w-[92vw] !translate-x-0 !translate-y-0 grid-rows-none flex-col gap-0 rounded-none border-l p-0 shadow-xl sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base leading-6">{title}</DialogTitle>
          {subtitle && <DialogDescription className="line-clamp-2">{subtitle}</DialogDescription>}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
