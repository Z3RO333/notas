import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { AdminPessoalCard } from '@/components/admin/indicadores/admin-pessoal-card'
import type { KpisNotasOrdens } from '@/lib/types/indicadores'
import { Card, CardContent } from '@/components/ui/card'
import {
  getNotesPanelListData,
  getNotesPanelSummaryData,
  loadNotesPanelSupportingData,
} from '@/lib/notes/get-notes-panel-data'

export const dynamic = 'force-dynamic'

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string
  value: string
  helper: string
}) {
  return (
    <Card className="border-border/60 bg-card/60 shadow-sm">
      <CardContent className="space-y-2 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="text-sm text-muted-foreground">
          {helper}
        </p>
      </CardContent>
    </Card>
  )
}

export default async function PessoasPage() {
  const adminCtx = await getCurrentAdminContext()
  const supabase = await createClient()

  let adminKpis: KpisNotasOrdens | null = null
  if (!adminCtx.isGestor && adminCtx.adminId) {
    const now = new Date()
    const startIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endExclIso = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    const { data } = await supabase.rpc('calcular_kpis_notas_ordens', {
      p_start_iso: startIso,
      p_end_exclusive_iso: endExclIso,
      p_admin_id: adminCtx.adminId,
    })
    adminKpis = (data ?? null) as KpisNotasOrdens | null
  }

  if (!adminCtx.isGestor && adminCtx.adminId && adminKpis) {
    return (
      <div className="space-y-6">
        <PageTitleBlock
          title="Minha Visao"
          subtitle="Seus indicadores operacionais no mes corrente."
        />
        <AdminPessoalCard
          nome={adminCtx.userName ?? 'Colaborador'}
          avatarUrl={null}
          kpis={adminKpis}
        />
      </div>
    )
  }

  const supportingData = loadNotesPanelSupportingData({
    currentAdminContext: {
      adminId: adminCtx.adminId,
      role: adminCtx.role,
      canViewGlobal: adminCtx.canViewGlobal,
    },
  })

  const [notesSummaryData, notesListData] = await Promise.all([
    getNotesPanelSummaryData({
      currentAdminContext: {
        adminId: adminCtx.adminId,
        role: adminCtx.role,
        canViewGlobal: adminCtx.canViewGlobal,
      },
      supportingData,
    }),
    getNotesPanelListData({
      currentAdminContext: {
        adminId: adminCtx.adminId,
        role: adminCtx.role,
        canViewGlobal: adminCtx.canViewGlobal,
      },
      supportingData,
    }),
  ])
  const totalNotasAbertas = notesSummaryData.collaborators.reduce((sum, collaborator) => sum + collaborator.qtd_abertas, 0)

  return (
    <div className="space-y-8">
      <PageTitleBlock title="Gestao de Pessoas" subtitle="Controle de disponibilidade, ferias e carga operacional dos colaboradores." />

      <section className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Leitura rapida
          </p>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Disponibilidade e volume atual da equipe
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Um retrato rapido da operacao antes de abrir a carteira individual de cada colaborador.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Ativos"
            value={notesSummaryData.teamStats.totalAtivos.toLocaleString('pt-BR')}
            helper={notesSummaryData.teamStats.inativos > 0 ? `${notesSummaryData.teamStats.inativos.toLocaleString('pt-BR')} inativos fora da carteira atual.` : 'Todos os cadastros operacionais estao ativos.'}
          />
          <SummaryCard
            label="Recebendo notas"
            value={notesSummaryData.teamStats.recebendo.toLocaleString('pt-BR')}
            helper="Colaboradores disponiveis para receber novas entradas."
          />
          <SummaryCard
            label="Em ferias"
            value={notesSummaryData.teamStats.emFerias.toLocaleString('pt-BR')}
            helper="Equipe temporariamente fora da distribuicao."
          />
          <SummaryCard
            label="Notas abertas"
            value={totalNotasAbertas.toLocaleString('pt-BR')}
            helper="Volume atual consolidado com a mesma base do painel de notas."
          />
        </div>
      </section>

      <section className="space-y-4 rounded-[28px] border border-border/60 bg-card/35 p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Carteira por colaborador
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Gestao operacional da equipe
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Esta pagina agora usa a mesma origem canonica do painel de notas para evitar divergencia
              entre contagem, filtros e regras de visibilidade.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
              Colaboradores no painel: {notesSummaryData.collaborators.length.toLocaleString('pt-BR')}
            </span>
            <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">
              Notas abertas: {totalNotasAbertas.toLocaleString('pt-BR')}
            </span>
          </div>
        </div>

        <CollaboratorPanel
          collaborators={notesSummaryData.collaborators}
          notas={notesListData.notasAtribuidas}
          mode="admin"
          preferCanonicalCollaboratorMetrics
          resultsArePartial={notesListData.listIsPartial}
          totalNotesCount={notesSummaryData.filteredNotesCount}
          loadedNotesCount={notesListData.listLoadedCount}
          operationalStateDegraded={notesListData.operationalStateDegraded}
        />
      </section>
    </div>
  )
}
