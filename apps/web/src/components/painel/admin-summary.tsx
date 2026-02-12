import { ClipboardList, AlertTriangle, CheckCircle } from 'lucide-react'
import type { NotaPanelData } from '@/lib/types/database'

interface AdminSummaryProps {
  notas: NotaPanelData[]
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function AdminSummary({ notas }: AdminSummaryProps) {
  const now = Date.now()

  const counts = {
    nova: notas.filter((n) => n.status === 'nova').length,
    aging: notas.filter((n) => {
      if (n.status === 'concluida' || n.status === 'cancelada') return false
      const created = n.data_criacao_sap ? new Date(n.data_criacao_sap).getTime() : 0
      return created > 0 && now - created > ONE_DAY_MS
    }).length,
    concluida: notas.filter((n) => n.status === 'concluida').length,
  }

  const items = [
    { label: 'Novas', count: counts.nova, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: '> 24h', count: counts.aging, icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Concluidas', count: counts.concluida, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
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
