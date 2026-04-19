'use client'

import { MapPin, Zap } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import type { OperacionalAdmin } from '@/lib/types/database'

interface OperacionalMapaProps {
  operacionais: OperacionalAdmin[]
}

function groupByGrupo(unidades: OperacionalAdmin['unidades']) {
  const groups = new Map<string, string[]>()
  for (const u of unidades) {
    const key = u.grupo_nome ?? 'Sem grupo'
    const existing = groups.get(key) ?? []
    existing.push(u.unidade)
    groups.set(key, existing)
  }
  return groups
}

export function OperacionalMapa({ operacionais }: OperacionalMapaProps) {
  if (operacionais.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
        Nenhum operacional com lojas configuradas.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {operacionais.map((op) => {
        const grupos = groupByGrupo(op.unidades)
        return (
          <div key={op.codigo} className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <Avatar src={op.avatar_url} nome={op.nome} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{op.nome}</p>
                {op.especialidade && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    {op.especialidade}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {op.unidades.length} {op.unidades.length === 1 ? 'loja' : 'lojas'}
              </span>
            </div>

            <div className="space-y-3 p-4">
              {grupos.size === 0 ? (
                <p className="text-sm text-muted-foreground">Sem lojas configuradas</p>
              ) : (
                Array.from(grupos.entries()).map(([grupoNome, lojas]) => (
                  <div key={grupoNome} className="space-y-1">
                    {grupoNome !== 'Sem grupo' && (
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {grupoNome}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-1">
                      {lojas.map((loja) => (
                        <div
                          key={loja}
                          className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5"
                        >
                          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="text-sm">{loja}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
