'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { registrarResultadoOrdem } from '@/lib/actions/saidas-actions'
import type { SaidaOrdem, SaidaOrdemResultado } from '@/lib/types/saidas'

const RESULTADO_CONFIG = {
  resolvida:     { label: 'Resolvida',     icon: CheckCircle2, className: 'bg-green-500 hover:bg-green-600 text-white' },
  nao_resolvida: { label: 'Não resolvida', icon: XCircle,      className: 'bg-red-500 hover:bg-red-600 text-white' },
  reagendada:    { label: 'Reagendada',    icon: Clock,        className: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
} as const

const BADGE_VARIANT: Record<SaidaOrdemResultado, 'default' | 'secondary' | 'destructive'> = {
  resolvida: 'default',
  nao_resolvida: 'destructive',
  reagendada: 'secondary',
}

interface SaidaOrdemCardProps {
  ordem: SaidaOrdem
}

export function SaidaOrdemCard({ ordem }: SaidaOrdemCardProps) {
  const [isPending, startTransition] = useTransition()
  const [mostrarObs, setMostrarObs] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [pendingResultado, setPendingResultado] = useState<SaidaOrdemResultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<SaidaOrdemResultado | null>(ordem.resultado)

  const concluida = resultado != null

  function handleResultado(r: SaidaOrdemResultado) {
    setPendingResultado(r)
    setMostrarObs(true)
  }

  function confirmarResultado() {
    if (!pendingResultado) return
    startTransition(async () => {
      const { error } = await registrarResultadoOrdem(ordem.id, pendingResultado, observacao || null)
      if (error) {
        setErro(error)
      } else {
        setResultado(pendingResultado)
        setMostrarObs(false)
        setErro(null)
      }
    })
  }

  return (
    <div className={`rounded-xl border p-4 transition-all ${concluida ? 'border-border/40 bg-muted/20 opacity-70' : 'border-border bg-card shadow-sm'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-mono text-base font-semibold">{ordem.ordemCodigo}</p>
        {resultado && (
          <Badge variant={BADGE_VARIANT[resultado]}>{RESULTADO_CONFIG[resultado].label}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {ordem.unidade}{ordem.textoBreve ? ` · ${ordem.textoBreve}` : ''}
      </p>

      {!concluida && !mostrarObs && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(Object.entries(RESULTADO_CONFIG) as [SaidaOrdemResultado, (typeof RESULTADO_CONFIG)[SaidaOrdemResultado]][]).map(([key, cfg]) => {
            const Icon = cfg.icon
            return (
              <button
                key={key}
                onClick={() => handleResultado(key)}
                disabled={isPending}
                className={`flex flex-col items-center gap-1 rounded-lg py-3 text-xs font-medium transition-opacity disabled:opacity-50 ${cfg.className}`}
              >
                <Icon className="h-5 w-5" />
                {cfg.label}
              </button>
            )
          })}
        </div>
      )}

      {mostrarObs && pendingResultado && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">
            {RESULTADO_CONFIG[pendingResultado].label} — observação (opcional):
          </p>
          <Textarea
            placeholder="Descreva o que foi feito…"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={confirmarResultado} disabled={isPending} className="flex-1">
              {isPending ? 'Salvando…' : 'Confirmar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setMostrarObs(false); setPendingResultado(null) }}>
              Voltar
            </Button>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>
      )}
    </div>
  )
}
