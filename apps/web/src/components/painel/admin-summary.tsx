import { ClipboardList, Clock, Send, CheckCircle } from 'lucide-react'
import type { NotaManutencao } from '@/lib/types/database'

interface AdminSummaryProps {
  notas: NotaManutencao[]
}

export function AdminSummary({ notas }: AdminSummaryProps) {
  const counts = {
    nova: notas.filter((n) => n.status === 'nova').length,
    em_andamento: notas.filter((n) => n.status === 'em_andamento').length,
    encaminhada: notas.filter((n) => n.status === 'encaminhada_fornecedor').length,
    concluida: notas.filter((n) => n.status === 'concluida').length,
  }

  const items = [
    { label: 'Novas', count: counts.nova, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Em Andamento', count: counts.em_andamento, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
    { label: 'Encaminhadas', count: counts.encaminhada, icon: Send, color: 'text-purple-600 bg-purple-50' },
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
