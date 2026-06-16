import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { SaidaAtivaBanner } from '@/components/operacional/saida-ativa-banner'
import type { OperacionalSaida } from '@/lib/types/saidas'

export const metadata: Metadata = { title: 'Portal Operacional | Cockpit' }
export const dynamic = 'force-dynamic'

export default async function OperacionalHomePage() {
  const ctx = await getCurrentAdminContext()
  const supabase = await createClient()

  let saidaAtiva: OperacionalSaida | null = null

  if (ctx.adminId) {
    const { data: adminData } = await supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('id', ctx.adminId)
      .maybeSingle()
    const opCodigo = (adminData as { operacional_codigo?: string | null } | null)?.operacional_codigo

    if (opCodigo) {
      const { data } = await supabase
        .from('operacional_saidas')
        .select(`
          id, operacional_codigo, operacional_nome_snapshot, criado_por_admin_id,
          status, data_saida, data_finalizacao, observacao, created_at,
          operacional_saida_ordens(count)
        `)
        .eq('operacional_codigo', opCodigo)
        .eq('status', 'em_rota')
        .order('data_saida', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        const s = data as Record<string, unknown>
        const ordensCounts = (s.operacional_saida_ordens as { count: number }[] | null) ?? []
        saidaAtiva = {
          id: s.id as string,
          operacionalCodigo: s.operacional_codigo as string,
          operacionalNomeSnapshot: s.operacional_nome_snapshot as string,
          criadoPorAdminId: s.criado_por_admin_id as string,
          status: 'em_rota',
          dataSaida: s.data_saida as string,
          dataFinalizacao: null,
          observacao: s.observacao as string | null,
          createdAt: s.created_at as string,
          totalOrdens: ordensCounts[0]?.count ?? 0,
        }
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Portal Operacional</h1>
        <p className="text-sm text-muted-foreground">Suas saídas e ordens de campo</p>
      </div>
      {saidaAtiva ? (
        <SaidaAtivaBanner saida={saidaAtiva} />
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma saída em andamento no momento.</p>
      )}
    </div>
  )
}
