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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
      <h2 className="text-lg font-semibold mb-2">Erro ao carregar Visao Geral</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Nao foi possivel carregar os dados do painel. Verifique sua conexao e tente novamente.
      </p>
      {error.digest ? (
        <p className="mb-4 text-xs text-muted-foreground">Codigo do erro: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  )
}
