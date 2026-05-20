'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Filter, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface CockpitFiltersProps {
  title?: string
  description?: string
  activeCount?: number
  onClear?: () => void
  children: React.ReactNode
  mobileChildren?: React.ReactNode
  rightSlot?: React.ReactNode
  className?: string
}

export function CockpitFilters({
  title = 'Filtros',
  description = 'Refine a visao sem sair do painel.',
  activeCount = 0,
  onClear,
  children,
  mobileChildren,
  rightSlot,
  className,
}: CockpitFiltersProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <section className={cn('sticky top-16 z-30 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80', className)}>
      <div className="flex items-center justify-between gap-2 md:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setMobileOpen(true)}>
          <Filter className="h-4 w-4" />
          {title}
          {activeCount > 0 ? (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>

        <div className="flex items-center gap-2">
          {onClear ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              <RotateCcw className="h-4 w-4" />
              Limpar
            </Button>
          ) : null}
          {rightSlot}
        </div>
      </div>

      <div className="hidden md:block">{children}</div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
          <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l bg-background shadow-xl outline-none">
            <div className="flex items-start justify-between gap-4 border-b px-4 py-4">
              <div className="space-y-1">
                <DialogTitle className="text-base">{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </div>
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Fechar filtros">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {mobileChildren ?? children}
            </div>

            <div className="flex items-center justify-between gap-2 border-t p-3">
              {onClear ? (
                <Button type="button" variant="outline" size="sm" onClick={onClear}>
                  <RotateCcw className="h-4 w-4" />
                  Limpar filtros
                </Button>
              ) : <span />}
              <Button type="button" size="sm" onClick={() => setMobileOpen(false)}>
                Aplicar
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </section>
  )
}
