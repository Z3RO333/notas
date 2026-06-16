'use client'

import { SaidaOrdemCard } from '@/components/operacional/saida-ordem-card'
import type { SaidaDetalhe } from '@/lib/types/saidas'

interface SaidaViewProps {
  saida: SaidaDetalhe
}

export function SaidaView({ saida }: SaidaViewProps) {
  const concluidas = saida.ordens.filter((o) => o.resultado != null).length
  const total = saida.ordens.length
  const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium">{concluidas} de {total} ordens concluídas</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {saida.observacao && (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium">Observação: </span>{saida.observacao}
        </p>
      )}

      <div className="space-y-3">
        {[...saida.ordens]
          .sort((a, b) => (a.resultado == null ? -1 : 1) - (b.resultado == null ? -1 : 1))
          .map((ordem) => (
            <SaidaOrdemCard key={ordem.id} ordem={ordem} />
          ))}
      </div>
    </div>
  )
}
