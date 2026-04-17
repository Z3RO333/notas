import { Info } from 'lucide-react'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import type { NotaLookupResult } from '@/lib/types/database'

interface NotaLookupBannerProps {
  lookupNota: NotaLookupResult
}

export function NotaLookupBanner({ lookupNota }: NotaLookupBannerProps) {
  const unidade = lookupNota.denominacao_unidade?.trim() || lookupNota.centro?.trim() || null

  return (
    <div
      role="status"
      aria-label="Nota encontrada em outra carteira"
      className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-950/30"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-blue-900 dark:text-blue-100">
          Nota {lookupNota.numero_nota} encontrada em outra carteira
        </p>
        <p className="text-blue-700 dark:text-blue-300">
          Responsável: <span className="font-semibold">{lookupNota.responsavel_nome}</span>
          {unidade ? <span className="text-blue-600 dark:text-blue-400"> · {unidade}</span> : null}
        </p>
        {lookupNota.descricao ? (
          <p className="truncate text-blue-600 dark:text-blue-400">{lookupNota.descricao}</p>
        ) : null}
      </div>
      <div className="shrink-0">
        <NotaStatusBadge status={lookupNota.status} />
      </div>
    </div>
  )
}
