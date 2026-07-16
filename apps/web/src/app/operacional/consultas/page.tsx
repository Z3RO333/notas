import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { ConsultasPanel } from '@/components/operacional/consultas-panel'
import type { SaidaDetalhe, SaidaOrdem } from '@/lib/types/saidas'

export const metadata: Metadata = { title: 'Consulta de Ordens | Cockpit' }

export default async function ConsultasPage() {
  const context = await getCurrentAdminContext()

  let operacionalCodigo: string | null = null
  let saidaAtiva: SaidaDetalhe | null = null
  if (context.adminId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('id', context.adminId)
      .maybeSingle()
    operacionalCodigo = (data as { operacional_codigo?: string | null } | null)?.operacional_codigo ?? null

    if (operacionalCodigo) {
      const { data: saidaData } = await supabase
        .from('operacional_saidas')
        .select(`
          id, operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
          status, data_saida, data_finalizacao, observacao, created_at,
          operacional_saida_ordens (
            id, saida_id, ordem_codigo, numero_nota, unidade, texto_breve,
            status_ordem_raw_snapshot, tipo_ordem, resultado,
            observacao_retorno, data_resultado, created_at
          )
        `)
        .eq('operacional_codigo', operacionalCodigo)
        .eq('status', 'em_rota')
        .order('data_saida', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (saidaData) {
        const s = saidaData as Record<string, unknown>
        const ordens = (s.operacional_saida_ordens as Record<string, unknown>[] | null) ?? []

        saidaAtiva = {
          id: s.id as string,
          operacionalCodigo: s.operacional_codigo as string,
          operacionalNomeSnapshot: s.operacional_nome_snapshot as string,
          criadoPorAdminId: s.criado_por_admin_id as string,
          status: s.status as SaidaDetalhe['status'],
          dataSaida: s.data_saida as string,
          dataFinalizacao: s.data_finalizacao as string | null,
          observacao: s.observacao as string | null,
          createdAt: s.created_at as string,
          totalOrdens: ordens.length,
          ordensComResultado: ordens.filter((o) => o.resultado != null).length,
          ordens: ordens.map((o): SaidaOrdem => ({
            id: o.id as string,
            saidaId: o.saida_id as string,
            ordemCodigo: o.ordem_codigo as string,
            numeroNota: o.numero_nota as string | null,
            unidade: o.unidade as string | null,
            textoBreve: o.texto_breve as string | null,
            statusOrdemRawSnapshot: o.status_ordem_raw_snapshot as string | null,
            tipoOrdem: o.tipo_ordem as string | null,
            resultado: o.resultado as SaidaOrdem['resultado'],
            observacaoRetorno: o.observacao_retorno as string | null,
            dataResultado: o.data_resultado as string | null,
            createdAt: o.created_at as string,
          })),
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Consulta de Ordens</h1>
        <p className="text-sm text-muted-foreground">Pesquise ordens de manutenção por número, unidade ou fornecedor</p>
      </div>
      <ConsultasPanel operacionalCodigo={operacionalCodigo} saidaAtiva={saidaAtiva} />
    </div>
  )
}
