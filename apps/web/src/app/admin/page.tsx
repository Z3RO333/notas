import { createClient } from '@/lib/supabase/server'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { LoadChart } from '@/components/dashboard/load-chart'
import { SyncHealth } from '@/components/dashboard/sync-health'
import { DistributeButton } from '@/components/dashboard/distribute-button'
import { ProductivityTable } from '@/components/dashboard/productivity-table'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import type { CargaAdministrador, NotaPanelData } from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

function toCargaCollaboratorData(c: CargaAdministrador): CollaboratorData {
  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    max_notas: c.max_notas,
    avatar_url: c.avatar_url,
    especialidade: c.especialidade,
    recebe_distribuicao: c.recebe_distribuicao,
    em_ferias: c.em_ferias,
    qtd_nova: c.qtd_nova,
    qtd_em_andamento: c.qtd_em_andamento,
    qtd_encaminhada: c.qtd_encaminhada,
    qtd_abertas: c.qtd_abertas,
    qtd_concluidas: c.qtd_concluidas,
  }
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const [cargaResult, syncResult, unassignedResult, adminsResult, prodResult, notasResult] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('qtd_abertas', { ascending: false }),
    supabase.from('sync_log').select('*').order('started_at', { ascending: false }).limit(10),
    supabase
      .from('notas_manutencao')
      .select('id', { count: 'exact', head: true })
      .is('administrador_id', null)
      .eq('status', 'nova'),
    supabase.from('administradores').select('id, ativo').eq('role', 'admin'),
    supabase.from('vw_produtividade_mensal').select('*').order('mes', { ascending: false }),
    supabase
      .from('notas_manutencao')
      .select('id, numero_nota, descricao, status, administrador_id, distribuida_em, updated_at, data_criacao_sap, prioridade, centro, ordem_sap')
      .not('administrador_id', 'is', null)
      .in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor', 'concluida'])
      .order('updated_at', { ascending: false })
      .limit(1000),
  ])

  const carga = cargaResult.data ?? []
  const syncLogs = syncResult.data ?? []
  const admins = adminsResult.data ?? []
  const produtividade = prodResult.data ?? []
  const todasNotas = notasResult.data ?? []

  const notasConcluidas = todasNotas.filter((n) => n.status === 'concluida')

  const totalAbertas = carga.reduce((sum, a) => sum + a.qtd_abertas, 0)
  const totalConcluidas = carga.reduce((sum, a) => sum + a.qtd_concluidas, 0)

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

  // Filtra gestores que nao recebem ordens e nao tem notas
  const cargaVisivel = carga.filter((c) => c.recebe_distribuicao || c.qtd_abertas > 0)
  const collaborators = cargaVisivel.map(toCargaCollaboratorData)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhamento da distribuicao e carga dos tecnicos
          </p>
        </div>
        <DistributeButton />
      </div>

      <StatsCards {...totals} />

      <CollaboratorPanel
        collaborators={collaborators}
        notas={todasNotas as NotaPanelData[]}
        mode="admin"
      />

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

      <ProductivityTable
        data={produtividade}
        notasConcluidas={notasConcluidas}
        totalAbertas={totalAbertas}
        totalConcluidas={totalConcluidas}
      />

      <RealtimeListener />
    </div>
  )
}
