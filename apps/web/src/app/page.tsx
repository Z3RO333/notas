import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import type {
  Especialidade,
  NotaPanelData,
  NotasMetrics30d,
  UserRole,
} from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const ADMIN_FIELDS = 'id, nome, ativo, max_notas, avatar_url, especialidade, recebe_distribuicao, em_ferias, role' as const
const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const

interface AdminRow {
  id: string
  nome: string
  ativo: boolean
  max_notas: number
  avatar_url: string | null
  especialidade: string | null
  recebe_distribuicao: boolean
  em_ferias: boolean
  role: string
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

function toCollaboratorData(admin: AdminRow, notas: NotaPanelData[]): CollaboratorData {
  const adminNotas = notas.filter((n) => n.administrador_id === admin.id)
  const aging = buildAgingCounts(adminNotas)

  return {
    id: admin.id,
    nome: admin.nome,
    ativo: admin.ativo,
    max_notas: admin.max_notas,
    avatar_url: admin.avatar_url,
    especialidade: (admin.especialidade as Especialidade) ?? 'geral',
    recebe_distribuicao: admin.recebe_distribuicao,
    em_ferias: admin.em_ferias,
    qtd_nova: adminNotas.filter((n) => n.status === 'nova').length,
    qtd_em_andamento: adminNotas.filter((n) => n.status === 'em_andamento').length,
    qtd_encaminhada: adminNotas.filter((n) => n.status === 'encaminhada_fornecedor').length,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: adminNotas.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada').length,
    qtd_concluidas: adminNotas.filter((n) => n.status === 'concluida').length,
    qtd_acompanhamento_ordens: 0,
  }
}

function fmtInteger(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0'
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtFloat(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value.toFixed(1)} d`
}

export default async function NotesPanelPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [adminsResult, notasResult, semAtribuirResult] = await Promise.all([
    supabase
      .from('administradores')
      .select(ADMIN_FIELDS)
      .order('nome'),
    supabase
      .from('vw_notas_sem_ordem')
      .select(NOTA_FIELDS)
      .not('administrador_id', 'is', null)
      .order('prioridade', { ascending: true })
      .order('data_criacao_sap', { ascending: true }),
    supabase
      .from('vw_notas_sem_ordem')
      .select(NOTA_FIELDS)
      .is('administrador_id', null)
      .order('data_criacao_sap', { ascending: true }),
  ])

  const admins = (adminsResult.data ?? []) as AdminRow[]
  const notas = (notasResult.data ?? []) as NotaPanelData[]
  const notasSemAtribuir = (semAtribuirResult.data ?? []) as NotaPanelData[]

  const loggedAdminResult = user?.email
    ? await supabase
      .from('administradores')
      .select('id, role')
      .eq('email', user.email)
      .single()
    : { data: null }

  const currentAdminId = loggedAdminResult.data?.id ?? null
  const currentAdminRole = toUserRole(loggedAdminResult.data?.role)

  let notesMetrics: NotasMetrics30d | null = null
  if (currentAdminRole === 'gestor') {
    const { data } = await supabase
      .from('vw_notas_metrics_30d')
      .select('*')
      .single()
    notesMetrics = (data ?? null) as NotasMetrics30d | null
  }

  const adminIds = new Set(notas.map((n) => n.administrador_id).filter(Boolean))
  const visiveis = admins.filter(
    (admin) => admin.recebe_distribuicao || !admin.ativo || admin.em_ferias || adminIds.has(admin.id)
  )

  const sorted = [...visiveis].sort((a, b) => {
    const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
    const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return 0
  })

  const collaborators = sorted.map((admin) => toCollaboratorData(admin, notas))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel de Notas</h1>
        <p className="text-sm text-muted-foreground">
          Operacao de notas pendentes sem ordem gerada.
        </p>
      </div>

      {currentAdminRole === 'gestor' && notesMetrics && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Notas criadas (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{fmtInteger(notesMetrics.qtd_notas_criadas_30d)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Viraram ordem (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-emerald-700">{fmtInteger(notesMetrics.qtd_notas_viraram_ordem_30d)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tempo medio p/ ordem</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-amber-700">{fmtFloat(notesMetrics.tempo_medio_para_ordem_dias_30d)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pendentes sem ordem</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-sky-700">{fmtInteger(notesMetrics.qtd_pendentes_sem_ordem)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notas}
        mode="viewer"
        notasSemAtribuir={notasSemAtribuir}
        currentAdminId={currentAdminId}
        currentAdminRole={currentAdminRole}
        ordensAcompanhamento={[]}
      />

      <RealtimeListener />
    </div>
  )
}
