'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { getAgingBadge, getAgingBucket, isOpenStatus } from '@/lib/collaborator/aging'
import type { NotaPanelData } from '@/lib/types/database'

interface NotaListItemProps {
  nota: NotaPanelData
}

export function NotaListItem({ nota }: NotaListItemProps) {
  const aging = isOpenStatus(nota.status)
    ? getAgingBadge(getAgingBucket(nota))
    : {
        label: nota.status === 'concluida' ? 'Concluída' : 'Cancelada',
        chip: 'bg-slate-100 text-slate-600',
      }
  const createdLabel = nota.data_criacao_sap
    ? format(new Date(`${nota.data_criacao_sap}T00:00:00`), 'dd/MM')
    : format(new Date(nota.created_at), 'dd/MM')

  return (
    <Link
      href={`/notas/${nota.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold text-foreground">
          #{nota.numero_nota}
        </p>
        <p className="truncate text-sm text-muted-foreground">{nota.descricao}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${aging.chip}`}>
          {aging.label}
        </span>
        <span className="w-10 text-right text-xs text-muted-foreground">{createdLabel}</span>
      </div>
    </Link>
  )
}
