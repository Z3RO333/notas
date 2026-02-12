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
      <DialogContent className="left-auto right-0 top-0 h-screen max-w-xl translate-x-0 translate-y-0 rounded-none border-l sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>

        <div className="max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
