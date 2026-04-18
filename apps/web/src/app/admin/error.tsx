'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GestorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin route error:', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <div className="rounded-3xl border border-dashed bg-card/50 p-8 text-center shadow-sm sm:p-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Nao foi possivel abrir o painel</h2>
      <p className="mt-2 mx-auto max-w-md text-sm leading-6 text-muted-foreground">
        Tente atualizar a tela. Se o erro continuar, use o código abaixo para investigação.
      </p>
      {error.digest ? (
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Codigo: {error.digest}
        </p>
      ) : null}
      <Button onClick={reset} className="mt-6">Tentar novamente</Button>
    </div>
  )
}
