import { createClient } from '@/lib/supabase/server'
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

export async function GraficosIndicadoresSectionServer({
  params,
  adminCtx,
}: GraficosIndicadoresSectionServerProps) {
  const supabase = await createClient()
  const { startDate, endDate, startIso, endExclusiveIso } = resolvePeriodoIndicadores(params)
  const adminScope = adminCtx.isGestor ? null : (adminCtx.adminId ?? null)

  const [kpisRes, resumoDiarioRes, lojasRes, colaboradoresRes, lojasOrdensRes, colaboradoresOrdensRes] = await Promise.all([
    supabase.rpc('calcular_kpis_notas_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    supabase.rpc('calcular_resumo_diario_notas_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    supabase.rpc('calcular_indicadores_por_loja_notas', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    adminCtx.isGestor
      ? supabase.rpc('calcular_indicadores_por_colaborador', {
          p_start_iso: startIso,
          p_end_exclusive_iso: endExclusiveIso,
        })
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc('calcular_indicadores_por_loja_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclusiveIso,
      p_admin_id: adminScope,
    }),
    adminCtx.isGestor
      ? supabase.rpc('calcular_indicadores_por_colaborador_ordens', {
          p_start_iso: startIso,
          p_end_exclusive_iso: endExclusiveIso,
          p_admin_id: adminScope,
        })
      : Promise.resolve({ data: [], error: null }),
  ])

  const mainError = [
    kpisRes.error,
    resumoDiarioRes.error,
    lojasRes.error,
    colaboradoresRes.error,
    lojasOrdensRes.error,
    colaboradoresOrdensRes.error,
  ].find(Boolean)

  if (mainError) {
    throw mainError
  }

  const kpis = (kpisRes.data ?? {
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
      resumoDiario={(resumoDiarioRes.data ?? []) as ResumoDiarioRow[]}
      lojas={(lojasRes.data ?? []) as LojaIndicadoresRow[]}
      colaboradores={(colaboradoresRes.data ?? []) as ColaboradorIndicadoresRow[]}
      lojasOrdens={(lojasOrdensRes.data ?? []) as LojaOrdensIndicadoresRow[]}
      colaboradoresOrdens={(colaboradoresOrdensRes.data ?? []) as ColaboradorOrdensIndicadoresRow[]}
    />
  )
}
