import { Card } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import type { CollaboratorData } from '@/lib/types/collaborator'
import type { Especialidade } from '@/lib/types/database'

interface CollaboratorMiniCardProps {
  collaborator: CollaboratorData
  isExpanded: boolean
  onClick: () => void
}

const especialidadeConfig: Record<Especialidade, { label: string; color: string }> = {
  refrigeracao: { label: 'Refrig.', color: 'bg-cyan-100 text-cyan-800' },
  elevadores: { label: 'Elev.', color: 'bg-orange-100 text-orange-800' },
  geral: { label: 'Geral', color: 'bg-gray-100 text-gray-800' },
}

function getUnavailableLabel(c: CollaboratorData): string | null {
  if (!c.ativo) return 'Inativo'
  if (c.em_ferias) return 'Em ferias'
  if (!c.recebe_distribuicao) return 'Pausado'
  return null
}

export function CollaboratorMiniCard({ collaborator, isExpanded, onClick }: CollaboratorMiniCardProps) {
  const esp = especialidadeConfig[collaborator.especialidade] ?? especialidadeConfig.geral
  const unavailable = getUnavailableLabel(collaborator)
  const percentual = collaborator.max_notas > 0
    ? Math.round((collaborator.qtd_abertas / collaborator.max_notas) * 100)
    : 0
  const barColor = percentual > 80 ? 'bg-red-500' : percentual > 50 ? 'bg-yellow-500' : 'bg-green-500'

  // Status dot
  const statusDot = !collaborator.ativo
    ? 'bg-gray-400'
    : collaborator.em_ferias
      ? 'bg-amber-400'
      : !collaborator.recebe_distribuicao
        ? 'bg-gray-400'
        : 'bg-green-500'

  return (
    <Card
      onClick={onClick}
      className={`p-3 cursor-pointer transition-all hover:shadow-md ${
        isExpanded ? 'ring-2 ring-primary bg-primary/5' : ''
      } ${unavailable ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        {/* Avatar + status dot */}
        <div className="relative shrink-0">
          <Avatar src={collaborator.avatar_url} nome={collaborator.nome} size="md" />
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${statusDot}`} />
        </div>

        {/* Name + specialty */}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{collaborator.nome}</p>
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${esp.color}`}>
              {esp.label}
            </span>
            {unavailable && (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-600">
                {unavailable}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Mini metrics */}
      <div className="flex gap-1.5 mt-2">
        <span className="flex-1 text-center rounded bg-blue-50 py-0.5 text-xs font-bold text-blue-700">
          {collaborator.qtd_nova}
        </span>
        <span className="flex-1 text-center rounded bg-yellow-50 py-0.5 text-xs font-bold text-yellow-700">
          {collaborator.qtd_em_andamento}
        </span>
        <span className="flex-1 text-center rounded bg-purple-50 py-0.5 text-xs font-bold text-purple-700">
          {collaborator.qtd_encaminhada}
        </span>
      </div>

      {/* Load bar */}
      <div className="mt-2 space-y-0.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{collaborator.qtd_abertas}/{collaborator.max_notas}</span>
          <span>{percentual}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className={`h-1.5 rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(percentual, 100)}%` }}
          />
        </div>
      </div>
    </Card>
  )
}
