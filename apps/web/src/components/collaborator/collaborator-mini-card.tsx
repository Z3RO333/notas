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
  if (c.em_ferias) return 'Em férias'
  if (!c.recebe_distribuicao) return 'Pausado'
  return null
}

export function CollaboratorMiniCard({ collaborator, isExpanded, onClick }: CollaboratorMiniCardProps) {
  const esp = especialidadeConfig[collaborator.especialidade] ?? especialidadeConfig.geral
  const unavailable = getUnavailableLabel(collaborator)

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

      {/* Mini metrics por atraso */}
      <div className="flex gap-1.5 mt-2">
        <span className="flex-1 text-center rounded bg-emerald-50 py-0.5 text-xs font-bold text-emerald-700">
          {collaborator.qtd_novo}
        </span>
        <span className="flex-1 text-center rounded bg-amber-50 py-0.5 text-xs font-bold text-amber-700">
          {collaborator.qtd_1_dia}
        </span>
        <span className="flex-1 text-center rounded bg-red-50 py-0.5 text-xs font-bold text-red-700">
          {collaborator.qtd_2_mais}
        </span>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Novo</span>
        <span>1 dia</span>
        <span>2+ dias</span>
      </div>

      <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
        {collaborator.qtd_abertas} nota(s) abertas
      </div>
    </Card>
  )
}
