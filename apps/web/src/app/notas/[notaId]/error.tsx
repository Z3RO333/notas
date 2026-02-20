'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotaError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
      <h2 className="text-lg font-semibold mb-2">Erro ao carregar nota</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Não foi possível carregar os detalhes desta nota. Ela pode ter sido removida ou houve um problema de conexão.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" asChild>
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar ao Painel
          </Link>
        </Button>
        <Button onClick={reset}>Tentar novamente</Button>
      </div>
    </div>
  )
}
