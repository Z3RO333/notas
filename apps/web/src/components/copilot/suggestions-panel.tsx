'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Lightbulb, ArrowRight } from 'lucide-react'
import type { CopilotSuggestion, SuggestionPriority } from '@/lib/types/copilot'

interface SuggestionsPanelProps {
  suggestions: CopilotSuggestion[]
  maxItems?: number
}

const PRIORITY_CONFIG: Record<SuggestionPriority, { badge: string; border: string }> = {
  alta: { badge: 'bg-red-100 text-red-700', border: 'border-l-red-500' },
  media: { badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-500' },
  baixa: { badge: 'bg-sky-100 text-sky-700', border: 'border-l-sky-500' },
}

const ACTION_LABELS: Record<string, string> = {
  redistribuir: 'Redistribuir',
  escalar: 'Escalar',
  pausar_distribuicao: 'Pausar',
  investigar_unidade: 'Investigar',
  investigar_colaborador_ordens: 'Investigar',
  redistribuir_ferias: 'Redistribuir',
}

export function SuggestionsPanel({ suggestions, maxItems = 5 }: SuggestionsPanelProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? suggestions : suggestions.slice(0, maxItems)
  const hiddenCount = Math.max(suggestions.length - maxItems, 0)

  if (visible.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            Sugestoes do Copilot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhuma sugestão no momento. A operação parece equilibrada.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4" />
          Sugestoes do Copilot ({suggestions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {visible.map((sug) => {
            const config = PRIORITY_CONFIG[sug.prioridade]

            return (
              <div
                key={sug.id}
                className={`rounded-lg border border-l-4 p-3 ${config.border}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${config.badge}`}>
                        {sug.prioridade.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {sug.dominio === 'ordens' ? 'Ordens' : 'Notas'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ACTION_LABELS[sug.acao] ?? sug.acao}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{sug.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{sug.descricao}</p>
                    <p className="text-xs text-emerald-600 mt-1">{sug.impacto}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs gap-1"
                    onClick={() => router.push(sug.viewHref)}
                  >
                    Ver
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        {suggestions.length > maxItems && (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Mostrar menos' : `Ver +${hiddenCount} sugestão(ões)`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
