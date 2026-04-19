import { ShoppingBag, Pill, Warehouse, type LucideIcon } from 'lucide-react'
import type {
  GestaoEvolucaoMes,
  GestaoTopLoja,
  GestaoTopServico,
  TipoUnidade,
} from '@/lib/types/database'
import { SegmentoChartsLazy } from './segmento-charts-lazy'

const SEGMENTO_CONFIG: Record<TipoUnidade, { label: string; cor: string; Icon: LucideIcon }> = {
  LOJA: { label: 'Lojas', cor: '#2563eb', Icon: ShoppingBag },
  FARMA: { label: 'Farmas', cor: '#16a34a', Icon: Pill },
  CD: { label: 'CDs', cor: '#d97706', Icon: Warehouse },
}

interface SegmentoSectionProps {
  tipo: TipoUnidade
  topLojas: GestaoTopLoja[]
  topServicos: GestaoTopServico[]
  evolucao: GestaoEvolucaoMes[]
  ano?: number
  mes?: number
  tipoOrdem?: string
}

export function SegmentoSection({
  tipo,
  topLojas,
  topServicos,
  evolucao,
  ano,
  mes,
  tipoOrdem,
}: SegmentoSectionProps) {
  const { label, cor, Icon } = SEGMENTO_CONFIG[tipo]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0" style={{ color: cor }} />
        <h2 className="text-base font-semibold" style={{ color: cor }}>
          {label}
        </h2>
        <div className="h-px flex-1 opacity-30" style={{ backgroundColor: cor }} />
      </div>

      <SegmentoChartsLazy
        tipo={tipo}
        topLojas={topLojas}
        topServicos={topServicos}
        evolucao={evolucao}
        ano={ano}
        mes={mes}
        tipoOrdem={tipoOrdem}
      />
    </div>
  )
}
