import Link from 'next/link'
import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getOrderStatusClass,
  getOrderStatusLabel,
  getSemaforoClass,
  getSemaforoLabel,
  sortOrdersByPriority,
} from '@/lib/orders/metrics'
import type { OrdemNotaAcompanhamento } from '@/lib/types/database'

interface OrdersAgingTableProps {
  rows: OrdemNotaAcompanhamento[]
  title?: string
  maxRows?: number
  showAdminColumns?: boolean
}

export function OrdersAgingTable({
  rows,
  title = 'Ordens em acompanhamento',
  maxRows = 20,
  showAdminColumns = true,
}: OrdersAgingTableProps) {
  const sorted = sortOrdersByPriority(rows).slice(0, maxRows)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ordem encontrada para esta janela.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((row) => (
              <Link
                key={row.ordem_id}
                href={`/notas/${row.nota_id}`}
                className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">#{row.numero_nota} • Ordem {row.ordem_codigo}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.descricao ?? 'Sem descricao'}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getSemaforoClass(row.semaforo_atraso)}`}>
                      {getSemaforoLabel(row.semaforo_atraso)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getOrderStatusClass(row.status_ordem)}`}>
                      {getOrderStatusLabel(row.status_ordem)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{row.dias_em_aberto} dia(s) em aberto</span>
                  <span>{row.unidade ?? 'Sem unidade'}</span>
                  {showAdminColumns && (
                    <span>
                      Atual: {row.responsavel_atual_nome ?? 'Sem responsavel'}
                    </span>
                  )}
                  {showAdminColumns && (
                    <span>
                      Origem: {row.administrador_nome ?? 'Nao identificado'}
                    </span>
                  )}
                  <span>
                    Historico: {row.tem_historico ? `${row.qtd_historico} registro(s)` : 'Sem historico'}
                  </span>
                  <span>
                    Detectada em {format(new Date(row.ordem_detectada_em), 'dd/MM/yyyy')}
                  </span>
                </div>
              </Link>
            ))}

            {rows.length > maxRows && (
              <p className="text-center text-xs text-muted-foreground">
                +{rows.length - maxRows} ordem(ns) fora da visualizacao atual
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
