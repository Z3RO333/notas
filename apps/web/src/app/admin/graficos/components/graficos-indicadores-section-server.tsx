import { createAdminClient } from '@/lib/supabase/admin'
import { IndicadoresSection } from '@/components/admin/indicadores/indicadores-section'
import { resolvePeriodoIndicadores } from '../graficos-page-shared'
import type {
  KpisNotasOrdens,
  ResumoDiarioRow,
  LojaIndicadoresRow,
  ColaboradorIndicadoresRow,
  LojaOrdensIndicadoresRow,
  ColaboradorOrdensIndicadoresRow,
} from '@/lib/types/indicadores'

interface GraficosIndicadoresSectionServerProps {
  params: Record<string, string | undefined>
  adminCtx: {
    isGestor: boolean
    adminId: string | null
  }
}

interface GraficosIndicadoresPayload {
  kpis?: Partial<KpisNotasOrdens>
  resumoDiario?: ResumoDiarioRow[]
  lojas?: LojaIndicadoresRow[]
  colaboradores?: ColaboradorIndicadoresRow[]
  lojasOrdens?: LojaOrdensIndicadoresRow[]
  colaboradoresOrdens?: ColaboradorOrdensIndicadoresRow[]
}

export async function GraficosIndicadoresSectionServer({
  params,
  adminCtx,
}: GraficosIndicadoresSectionServerProps) {
  const supabase = createAdminClient()
  const { startDate, endDate, startIso, endExclusiveIso } = resolvePeriodoIndicadores(params)
  const adminScope = adminCtx.isGestor ? null : (adminCtx.adminId ?? null)

  const payloadResult = await supabase.rpc('buscar_graficos_indicadores_agregado', {
    p_start_iso: startIso,
    p_end_exclusive_iso: endExclusiveIso,
    p_admin_id: adminScope,
    p_include_colaboradores: adminCtx.isGestor,
  })

  if (payloadResult.error) {
    throw payloadResult.error
  }

  const payload = (payloadResult.data ?? {}) as GraficosIndicadoresPayload
  const kpis = (payload.kpis ?? {
    total_notas: 0,
    notas_convertidas: 0,
    taxa_conversao: 0,
    tempo_medio_nota_ordem: null,
    tempo_medio_conclusao: null,
    total_ordens_concluidas: 0,
  }) as KpisNotasOrdens

  return (
    <IndicadoresSection
      isGestor={adminCtx.isGestor}
      startDate={startDate}
      endDate={endDate}
      kpis={kpis}
      resumoDiario={payload.resumoDiario ?? []}
      lojas={payload.lojas ?? []}
      colaboradores={payload.colaboradores ?? []}
      lojasOrdens={payload.lojasOrdens ?? []}
      colaboradoresOrdens={payload.colaboradoresOrdens ?? []}
    />
  )
}
