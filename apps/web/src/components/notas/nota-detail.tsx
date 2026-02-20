import { format } from 'date-fns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { NotaStatusBadge } from './nota-status-badge'
import type { NotaManutencao } from '@/lib/types/database'

interface NotaDetailProps {
  nota: NotaManutencao
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '-'}</span>
    </div>
  )
}

const prioridadeLabel: Record<string, string> = {
  '1': '1 - Muito Alta',
  '2': '2 - Alta',
  '3': '3 - Media',
  '4': '4 - Baixa',
}

export function NotaDetail({ nota }: NotaDetailProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">
          Nota {nota.numero_nota}
        </CardTitle>
        <NotaStatusBadge status={nota.status} />
      </CardHeader>
      <CardContent className="space-y-1">
        <InfoRow label="Descrição" value={nota.descricao} />
        <InfoRow label="Descrição do Objeto" value={nota.descricao_objeto} />
        <InfoRow label="Tipo de Nota" value={nota.tipo_nota} />
        <InfoRow
          label="Prioridade"
          value={nota.prioridade ? (prioridadeLabel[nota.prioridade] || nota.prioridade) : null}
        />
        <InfoRow label="Centro" value={nota.centro} />
        <InfoRow label="Solicitante" value={nota.solicitante} />
        <InfoRow label="Criado por (SAP)" value={nota.criado_por_sap} />
        <InfoRow label="Autor da Nota" value={nota.autor_nota} />
        <InfoRow
          label="Data de Criação"
          value={nota.data_criacao_sap ? format(new Date(nota.data_criacao_sap), 'dd/MM/yyyy') : null}
        />
        <InfoRow label="Hora" value={nota.hora_nota} />
        <InfoRow label="Ordem SAP" value={nota.ordem_sap} />
        <InfoRow label="Status SAP" value={nota.status_sap} />
        <InfoRow label="Conta Fornecedor" value={nota.conta_fornecedor} />
        {nota.ordem_gerada && <InfoRow label="Ordem Gerada" value={nota.ordem_gerada} />}
        {nota.fornecedor_encaminhado && <InfoRow label="Fornecedor Encaminhado" value={nota.fornecedor_encaminhado} />}
        {nota.observacoes && <InfoRow label="Observações" value={nota.observacoes} />}
        <InfoRow
          label="Distribuída em"
          value={nota.distribuida_em ? format(new Date(nota.distribuida_em), 'dd/MM/yyyy HH:mm') : null}
        />
      </CardContent>
    </Card>
  )
}
