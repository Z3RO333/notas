import { CheckCircle, Clock3, Timer } from 'lucide-react'
import { getAgingBucket, isOpenStatus } from '@/lib/collaborator/aging'
import type { NotaPanelData } from '@/lib/types/database'

interface AdminSummaryProps {
  notas: NotaPanelData[]
}

export function AdminSummary({ notas }: AdminSummaryProps) {
  const counts = {
    novo: notas.filter((n) => isOpenStatus(n.status) && getAgingBucket(n) === 'novo').length,
    umDia: notas.filter((n) => isOpenStatus(n.status) && getAgingBucket(n) === 'um_dia').length,
    doisMais: notas.filter((n) => isOpenStatus(n.status) && getAgingBucket(n) === 'dois_mais').length,
    concluida: notas.filter((n) => n.status === 'concluida').length,
  }

  const items = [
    { label: 'Novo', count: counts.novo, icon: CheckCircle, color: 'text-emerald-700 bg-emerald-50' },
    { label: '1 dia', count: counts.umDia, icon: Clock3, color: 'text-amber-700 bg-amber-50' },
    { label: '2+ dias', count: counts.doisMais, icon: Timer, color: 'text-red-700 bg-red-50' },
    { label: 'Concluídas', count: counts.concluida, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
  ]

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.label}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${item.color}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{item.count} {item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
