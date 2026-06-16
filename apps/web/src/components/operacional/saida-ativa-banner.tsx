import Link from 'next/link'
import { ArrowRight, Truck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { OperacionalSaida } from '@/lib/types/saidas'

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

interface SaidaAtivaBannerProps {
  saida: OperacionalSaida
}

export function SaidaAtivaBanner({ saida }: SaidaAtivaBannerProps) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <Truck className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="font-semibold">Saída em andamento</p>
            <p className="text-sm text-muted-foreground">
              {fmtDate(saida.dataSaida)} · {saida.totalOrdens} ordem(ns) pendente(s)
            </p>
          </div>
        </div>
        <Link href={`/operacional/saida/${saida.id}`}>
          <Button size="sm" className="gap-1.5">
            Acessar <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
