'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global app error:', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background p-6">
        <div className="mx-auto mt-16 flex w-full max-w-xl flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <AlertTriangle className="mb-4 h-10 w-10 text-destructive" />
          <h2 className="mb-2 text-lg font-semibold">Algo deu errado na aplicacao</h2>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            Nao foi possivel renderizar a pagina. Tente novamente.
          </p>
          {error.digest ? (
            <p className="mb-4 text-xs text-muted-foreground">Codigo do erro: {error.digest}</p>
          ) : null}
          <Button onClick={reset}>Tentar novamente</Button>
        </div>
      </body>
    </html>
  )
}
