'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { getAgingBadge, getAgingBucket, isOpenStatus } from '@/lib/collaborator/aging'
import { copyToClipboard } from '@/lib/orders/copy'
import type { NotaPanelData } from '@/lib/types/database'

interface NotaListItemProps {
  nota: NotaPanelData
}

export function NotaListItem({ nota }: NotaListItemProps) {
  const [copied, setCopied] = useState(false)

  const aging = isOpenStatus(nota.status)
    ? getAgingBadge(getAgingBucket(nota))
    : {
        label: nota.status === 'concluida' ? 'Concluída' : 'Cancelada',
        chip: 'bg-slate-100 text-slate-600',
      }
  const createdLabel = nota.data_criacao_sap
    ? format(new Date(`${nota.data_criacao_sap}T00:00:00`), 'dd/MM')
    : format(new Date(nota.created_at), 'dd/MM')

  function handleClick() {
    copyToClipboard(nota.numero_nota)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/40"
      title={`Clique para copiar #${nota.numero_nota}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold text-foreground">
          #{nota.numero_nota}
        </p>
        <p className="truncate text-sm text-muted-foreground">{nota.descricao}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {copied ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            ✓ Copiado
          </span>
        ) : (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${aging.chip}`}>
            {aging.label}
          </span>
        )}
        <span className="w-10 text-right text-xs text-muted-foreground">{createdLabel}</span>
        <Link
          href={`/notas/${nota.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
          title="Abrir nota"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
