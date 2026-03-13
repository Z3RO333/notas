'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock, TrendingUp, Users } from 'lucide-react'
import type {
  Prediction,
  PredictionConfianca,
  PredictionKind,
  PredictionSeverity,
  PredictionTendencia,
} from '@/lib/types/copilot'

interface PredictionsPanelProps {
  predictions: Prediction[]
}

const SEVERITY_CONFIG: Record<PredictionSeverity, { border: string; icon: string; badge: string }> = {
  alta: {
    border: 'border-l-red-500',
    icon: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  media: {
    border: 'border-l-amber-500',
    icon: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
  },
  baixa: {
    border: 'border-l-sky-500',
    icon: 'text-sky-600',
    badge: 'bg-sky-100 text-sky-700',
  },
}

const TYPE_ICON = {
  backlog_crescendo: TrendingUp,
  aging_sla_estouro: Clock,
  taxa_entrada_alta: TrendingUp,
  sobrecarga_continua: Users,
}

const KIND_LABEL: Record<PredictionKind, string> = {
  projecao: 'Projecao',
  tendencia: 'Tendencia',
  alerta_antecipado: 'Alerta',
}

const CONFIANCA_STYLE: Record<PredictionConfianca, string> = {
  alta: 'bg-slate-200 text-slate-700',
  media: 'bg-slate-100 text-slate-600',
  baixa: 'bg-slate-50 text-slate-500',
}

const TENDENCIA_LABEL: Record<PredictionTendencia, string> = {
  piorando: '↑ piorando',
  estavel: '-> estavel',
  melhorando: '↓ melhorando',
}

export function PredictionsPanel({ predictions }: PredictionsPanelProps) {
  if (predictions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Predicoes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhuma predicao de risco no momento.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Predicoes ({predictions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {predictions.map((pred, index) => {
            const config = SEVERITY_CONFIG[pred.severidade]
            const Icon = TYPE_ICON[pred.tipo]

            return (
              <div
                key={`${pred.tipo}-${pred.adminId ?? index}`}
                className={`rounded-lg border border-l-4 p-3 ${config.border}`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.icon}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${config.badge}`}>
                        {pred.severidade.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                        {KIND_LABEL[pred.kind]}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CONFIANCA_STYLE[pred.confianca]}`}>
                        Conf. {pred.confianca}
                      </span>
                      {pred.diasParaEvento > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ~{pred.diasParaEvento}d
                        </span>
                      )}
                      {pred.diasParaEvento === 0 && (
                        <span className="text-xs text-red-600 font-medium">AGORA</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {TENDENCIA_LABEL[pred.tendencia]}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{pred.mensagem}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
