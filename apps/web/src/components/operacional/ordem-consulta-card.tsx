import { Mail, MapPin, User, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { OrdemConsulta } from '@/lib/types/operacional'

const STATUS_LABELS: Record<string, string> = {
  EQUIPAMENTO_EM_CONSERTO: 'Em conserto',
  EM_PROCESSAMENTO: 'Em processamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  ABERTA: 'Aberta',
}

const SEMAFORO_CLASSES = {
  verde: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  amarelo: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  vermelho: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  neutro: 'bg-muted text-muted-foreground',
}

interface OrdemConsultaCardProps {
  ordem: OrdemConsulta
}

export function OrdemConsultaCard({ ordem }: OrdemConsultaCardProps) {
  const statusLabel = STATUS_LABELS[ordem.statusOrdemRaw] ?? ordem.statusOrdemRaw
  const semaforoClass = SEMAFORO_CLASSES[ordem.semaforoAtraso]
  const isFinalizado = ordem.semaforoAtraso === 'neutro'

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold leading-tight">{ordem.ordemCodigo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Nota {ordem.numeroNota}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Badge variant="outline" className="text-xs whitespace-nowrap">
            {statusLabel}
          </Badge>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', semaforoClass)}>
            {isFinalizado ? 'Finalizada' : `${ordem.diasEmAberto}d em aberto`}
          </span>
        </div>
      </div>

      {ordem.descricao && (
        <p className="text-sm leading-snug text-foreground/80 line-clamp-2">{ordem.descricao}</p>
      )}

      <div className="space-y-1.5 text-xs text-muted-foreground">
        {ordem.unidade && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{ordem.unidade}</span>
          </div>
        )}

        {ordem.fornecedorNome && (
          <div className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {ordem.fornecedorNome}
              {ordem.fornecedorCodigo ? ` (${ordem.fornecedorCodigo})` : ''}
            </span>
          </div>
        )}

        {ordem.responsavelNome && (
          <div className="flex items-start gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span>{ordem.responsavelNome}</span>
              {ordem.responsavelEmail && (
                <a
                  href={`mailto:${ordem.responsavelEmail}`}
                  className="ml-1.5 inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <Mail className="h-3 w-3" />
                  {ordem.responsavelEmail}
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {ordem.tipoOrdem && (
        <div className="flex justify-end pt-0.5">
          <span className="text-[11px] text-muted-foreground/60 font-mono">{ordem.tipoOrdem}</span>
        </div>
      )}
    </div>
  )
}
