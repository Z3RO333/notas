'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { PedidosMiniCard } from '@/components/pedidos/pedidos-mini-card'
import { PedidosAccordion } from '@/components/pedidos/pedidos-accordion'
import type { PedidosAdminSummary, PedidosSummaryResponse } from '@/lib/types/pedidos'
import type { UserRole } from '@/lib/types/database'

interface PedidosPanelProps {
  initialUser: {
    role: UserRole
    adminId: string
    canViewGlobal: boolean
  }
}

function usePedidosSummary() {
  return useQuery<PedidosAdminSummary[]>({
    queryKey: ['pedidos-summary'],
    queryFn: async () => {
      const res = await fetch('/api/pedidos/summary', { cache: 'no-store' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || 'Falha ao carregar resumo de pedidos')
      }
      const data = (await res.json()) as PedidosSummaryResponse
      return data.admins
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })
}

export function PedidosPanel({ initialUser }: PedidosPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: admins, isPending, error } = usePedidosSummary()

  function handleCardClick(adminId: string) {
    setExpandedId((prev) => (prev === adminId ? null : adminId))
  }

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Erro ao carregar pedidos.'}
      </p>
    )
  }

  if (!admins || admins.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
        Nenhum administrador encontrado.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {admins.map((admin) => (
          <div key={admin.adminId}>
            <PedidosMiniCard
              admin={admin}
              isExpanded={expandedId === admin.adminId}
              onClick={() => handleCardClick(admin.adminId)}
            />
          </div>
        ))}
      </div>

      {expandedId && (
        <PedidosAccordion
          key={expandedId}
          adminId={expandedId}
          isOpen={true}
        />
      )}
    </div>
  )
}
