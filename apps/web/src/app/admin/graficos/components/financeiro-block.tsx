import { Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function FinanceiroBlock() {
  return (
    <Card className="border-dashed opacity-60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
          <Lock className="h-4 w-4" />
          Inteligência Financeira
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Em breve — aguardando integração do campo <code className="text-xs bg-muted px-1 py-0.5 rounded">valor_total</code> na sincronização SAP.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            'Valor total por loja',
            'Valor total por fornecedor',
            'Valor médio por serviço',
            'Custo acumulado mensal',
          ].map((label) => (
            <div
              key={label}
              className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
