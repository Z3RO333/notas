import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { SaidaDetalhePanel } from '@/components/saidas/saida-detalhe-panel'
import type {
  RotaDispatchStatus,
  RotaDispatchSummary,
  RedistribuicaoOrdemResumo,
  SaidaDetalhe,
  SaidaOrdem,
} from '@/lib/types/saidas'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Saída Operacional | Cockpit' }

export default async function SaidaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound()
  }
  const supabase = createAdminClient()

  const [
    { data, error },
    { data: dispatch },
    { data: operacionais },
    { data: contasOperacionais },
    { data: redistribuicoes },
  ] = await Promise.all([
    supabase
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
      .eq('id', id)
      .maybeSingle(),
    supabase
      .schema('integration')
      .from('route_dispatches')
      .select('id, status, published_at')
      .eq('cockpit_cargo_id', id)
      .maybeSingle(),
    supabase
      .from('dim_operacionais')
      .select('codigo, nome')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('ativo', true)
      .eq('role', 'operacional')
      .not('auth_user_id', 'is', null)
      .not('operacional_codigo', 'is', null),
    supabase
      .from('operacional_ordem_redistribuicoes')
      .select(`
        id, order_number, source_operational_name, target_operational_name,
        status, motivo, sap_sync_status, created_at, completed_at
      `)
      .or(`source_cockpit_cargo_id.eq.${id},target_cockpit_cargo_id.eq.${id}`)
      .order('created_at', { ascending: false }),
  ])

  if (error || !data) notFound()

  const s = data as Record<string, unknown>
  const ordens = (s.operacional_saida_ordens as Record<string, unknown>[]) ?? []

  const saida: SaidaDetalhe = {
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

  const rotaDispatch: RotaDispatchSummary | null = dispatch
    ? {
        id: dispatch.id as string,
        status: dispatch.status as RotaDispatchStatus,
        publishedAt: dispatch.published_at as string,
      }
    : null

  const transferHistory: RedistribuicaoOrdemResumo[] = (redistribuicoes ?? []).map((row) => ({
    id: row.id as string,
    orderNumber: row.order_number as string,
    sourceOperationalName: row.source_operational_name as string,
    targetOperationalName: row.target_operational_name as string,
    status: row.status as RedistribuicaoOrdemResumo['status'],
    motivo: row.motivo as string,
    sapSyncStatus: row.sap_sync_status as RedistribuicaoOrdemResumo['sapSyncStatus'],
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | null,
  }))

  const accountCountByOperationalCode = new Map<string, number>()
  for (const account of contasOperacionais ?? []) {
    if (typeof account.operacional_codigo !== 'string') continue
    accountCountByOperationalCode.set(
      account.operacional_codigo,
      (accountCountByOperationalCode.get(account.operacional_codigo) ?? 0) + 1,
    )
  }
  const eligibleOperationalCodes = new Set(
    [...accountCountByOperationalCode.entries()]
      .filter(([, accountCount]) => accountCount === 1)
      .map(([operationalCode]) => operationalCode),
  )
  const eligibleOperationalOptions = (operacionais ?? []).filter(
    (operacional) => eligibleOperationalCodes.has(operacional.codigo as string),
  ) as Array<{ codigo: string; nome: string }>

  return (
    <div className="py-5">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Saída Operacional</h1>
      </div>
      <SaidaDetalhePanel
        saida={saida}
        rotaDispatch={rotaDispatch}
        operacionais={eligibleOperationalOptions}
        redistribuicoes={transferHistory}
      />
    </div>
  )
}
