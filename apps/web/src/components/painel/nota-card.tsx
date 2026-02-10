'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { NotaStatusBadge } from '@/components/notas/nota-status-badge'
import type { NotaManutencao } from '@/lib/types/database'

const prioridadeLabel: Record<string, string> = {
  '1': 'Muito Alta',
  '2': 'Alta',
  '3': 'Media',
  '4': 'Baixa',
}

const prioridadeColor: Record<string, string> = {
  '1': 'border-l-red-500',
  '2': 'border-l-orange-500',
  '3': 'border-l-yellow-500',
  '4': 'border-l-green-500',
}

interface NotaCardProps {
  nota: NotaManutencao
}

export function NotaCard({ nota }: NotaCardProps) {
  const prioridadeCor = nota.prioridade ? (prioridadeColor[nota.prioridade] || 'border-l-gray-300') : 'border-l-gray-300'

  return (
    <Link href={`/notas/${nota.id}`}>
      <div
        className={`group rounded-lg border border-l-4 ${prioridadeCor} bg-card p-4 transition-all hover:shadow-md hover:border-l-primary cursor-pointer`}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className="font-mono text-sm font-bold text-foreground">
            #{nota.numero_nota}
          </span>
          <NotaStatusBadge status={nota.status} />
        </div>

        <p className="text-sm text-foreground/80 line-clamp-2 mb-3 min-h-[2.5rem]">
          {nota.descricao}
        </p>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {nota.centro && (
              <span className="rounded bg-muted px-1.5 py-0.5">{nota.centro}</span>
            )}
            {nota.prioridade && (
              <span>{prioridadeLabel[nota.prioridade] || nota.prioridade}</span>
            )}
          </div>
          {nota.data_criacao_sap && (
            <span>{format(new Date(nota.data_criacao_sap), 'dd/MM/yyyy')}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
