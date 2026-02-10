import { createClient } from '@/lib/supabase/server'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { LoadChart } from '@/components/dashboard/load-chart'
import { DistributionTable } from '@/components/dashboard/distribution-table'
import { SyncHealth } from '@/components/dashboard/sync-health'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { RealtimeListener } from '@/components/notas/realtime-listener'

export const dynamic = 'force-dynamic'

export default async function GestorPage() {
  const supabase = createClient()

  const [cargaResult, syncResult, unassignedResult, adminsResult] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('qtd_abertas', { ascending: false }),
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(10),
    supabase
      .from('notas_manutencao')
      .select('id', { count: 'exact', head: true })
      .is('administrador_id', null)
      .eq('status', 'nova'),
    supabase.from('administradores').select('id, ativo').eq('role', 'admin'),
  ])

  const carga = cargaResult.data ?? []
  const syncLogs = syncResult.data ?? []
  const admins = adminsResult.data ?? []

  const totals = carga.reduce(
    (acc, a) => ({
      nova: acc.nova + a.qtd_nova,
      emAndamento: acc.emAndamento + a.qtd_em_andamento,
      encaminhada: acc.encaminhada + a.qtd_encaminhada,
      concluida: acc.concluida + a.qtd_concluidas,
    }),
    { nova: 0, emAndamento: 0, encaminhada: 0, concluida: 0 }
  )

  const notasSemAtribuir = unassignedResult.count ?? 0
  totals.nova += notasSemAtribuir

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visao Geral</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhamento da distribuicao e carga dos tecnicos
          </p>
        </div>
        <DistributeButton />
      </div>

      <StatsCards {...totals} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadChart carga={carga} />
        </div>
        <SyncHealth
          logs={syncLogs}
          adminsAtivos={admins.filter((a) => a.ativo).length}
          adminsTotal={admins.length}
          notasSemAtribuir={notasSemAtribuir}
        />
      </div>

      <DistributionTable carga={carga} />

      <RealtimeListener />
    </div>
  )
}
