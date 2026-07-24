'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const variantStyles: Record<ToastVariant, { bg: string; icon: typeof CheckCircle }> = {
  success: { bg: 'border-success/30 bg-success/10 text-foreground', icon: CheckCircle },
  error: { bg: 'border-destructive/30 bg-destructive/10 text-foreground', icon: AlertTriangle },
  info: { bg: 'border-info/30 bg-info/10 text-foreground', icon: Info },
}

const iconColor: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-destructive',
  info: 'text-info',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...opts, id }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => {
          const style = variantStyles[t.variant]
          const Icon = style.icon
          return (
            <ToastPrimitive.Root
              key={t.id}
              className={cn(
                'group pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg transition-all',
                'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none',
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full',
                'data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full',
                style.bg
              )}
              onOpenChange={(open) => {
                if (!open) removeToast(t.id)
              }}
            >
              <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', iconColor[t.variant])} />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {t.title}
                </ToastPrimitive.Title>
                {t.description && (
                  <ToastPrimitive.Description className="text-sm text-muted-foreground mt-1">
                    {t.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                aria-label="Fechar notificação"
                className="rounded-md p-1 opacity-70 transition-opacity hover:bg-foreground/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed inset-x-4 top-4 z-[100] flex max-h-screen w-auto flex-col gap-2 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
