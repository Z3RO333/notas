import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ClipboardList, Clock, Send, CheckCircle } from 'lucide-react'

interface StatsCardsProps {
  nova: number
  emAndamento: number
  encaminhada: number
  concluida: number
}

export function StatsCards({ nova, emAndamento, encaminhada, concluida }: StatsCardsProps) {
  const cards = [
    { label: 'Novas', value: nova, icon: ClipboardList, color: 'text-blue-600' },
    { label: 'Em Andamento', value: emAndamento, icon: Clock, color: 'text-yellow-600' },
    { label: 'Encaminhadas', value: encaminhada, icon: Send, color: 'text-purple-600' },
    { label: 'Concluídas', value: concluida, icon: CheckCircle, color: 'text-green-600' },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <Icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${card.color}`}>{card.value}</div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
