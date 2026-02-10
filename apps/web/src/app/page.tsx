import { createClient } from '@/lib/supabase/server'
import { AdminTabs } from '@/components/painel/admin-tabs'
import { RealtimeListener } from '@/components/notas/realtime-listener'

export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const supabase = createClient()

  const [adminsResult, notasResult, semAtribuirResult] = await Promise.all([
    supabase
      .from('administradores')
      .select('*')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('notas_manutencao')
      .select('*')
      .not('administrador_id', 'is', null)
      .order('prioridade', { ascending: true })
      .order('data_criacao_sap', { ascending: true }),
    supabase
      .from('notas_manutencao')
      .select('*')
      .is('administrador_id', null)
      .order('data_criacao_sap', { ascending: true }),
  ])

  const admins = adminsResult.data ?? []
  const notas = notasResult.data ?? []
  const notasSemAtribuir = semAtribuirResult.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel de Ordens</h1>
        <p className="text-sm text-muted-foreground">
          Ordens de manutencao por tecnico
        </p>
      </div>

      <AdminTabs
        admins={admins}
        notas={notas}
        notasSemAtribuir={notasSemAtribuir}
      />

      <RealtimeListener />
    </div>
  )
}
