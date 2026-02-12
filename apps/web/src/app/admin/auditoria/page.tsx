import { createClient } from '@/lib/supabase/server'
import { AuditTable } from '@/components/admin/audit-table'
import type { AdminAuditLog } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

export default async function AuditoriaPage() {
  const supabase = await createClient()

  const { data: rawLogs } = await supabase
    .from('admin_audit_log')
    .select(`
      id,
      gestor_id,
      acao,
      alvo_id,
      detalhes,
      created_at,
      gestor:administradores!gestor_id(nome),
      alvo:administradores!alvo_id(nome)
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  // Supabase returns joined relations as arrays — flatten to single objects
  const logs: AdminAuditLog[] = (rawLogs ?? []).map((row) => ({
    ...row,
    gestor: Array.isArray(row.gestor) ? row.gestor[0] ?? null : row.gestor,
    alvo: Array.isArray(row.alvo) ? row.alvo[0] ?? null : row.alvo,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Registro de todas as acoes administrativas
        </p>
      </div>

      <AuditTable logs={logs} />
    </div>
  )
}
