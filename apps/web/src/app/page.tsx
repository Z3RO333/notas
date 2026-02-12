import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { OrdersAgingTable } from '@/components/orders/orders-aging-table'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import type {
  NotaPanelData,
  Especialidade,
  OrdemAcompanhamento,
  OrdemNotaAcompanhamento,
} from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const ADMIN_FIELDS = 'id, nome, ativo, max_notas, avatar_url, especialidade, recebe_distribuicao, em_ferias, role' as const
const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const
const ORDER_TRACKING_WINDOW_DAYS = 90

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

function toCollaboratorData(
  admin: AdminRow,
  notas: NotaPanelData[],
  qtdAcompanhamentoOrdens: number
): CollaboratorData {
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
    qtd_acompanhamento_ordens: qtdAcompanhamentoOrdens,
  }
}

export default async function PainelPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [adminsResult, notasResult, semAtribuirResult] = await Promise.all([
    supabase
      .from('administradores')
      .select(ADMIN_FIELDS)
      .order('nome'),
    supabase
      .from('notas_manutencao')
      .select(NOTA_FIELDS)
      .not('administrador_id', 'is', null)
      .order('prioridade', { ascending: true })
      .order('data_criacao_sap', { ascending: true }),
    supabase
      .from('notas_manutencao')
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
  const currentAdminRole = loggedAdminResult.data?.role ?? null

  let ordensAcompanhamento: OrdemAcompanhamento[] = []
  if (currentAdminRole === 'admin' && currentAdminId) {
    const { data } = await supabase
      .from('vw_ordens_acompanhamento')
      .select('*')
      .or(`administrador_id.eq.${currentAdminId},responsavel_atual_id.eq.${currentAdminId}`)
      .order('acompanhamento_em', { ascending: false })
    ordensAcompanhamento = (data ?? []) as OrdemAcompanhamento[]
  } else if (currentAdminRole === 'gestor') {
    const { data } = await supabase
      .from('vw_ordens_acompanhamento')
      .select('*')
      .order('acompanhamento_em', { ascending: false })
      .limit(100)
    ordensAcompanhamento = (data ?? []) as OrdemAcompanhamento[]
  }

  let ordensNotasAcompanhamento: OrdemNotaAcompanhamento[] = []
  if (currentAdminRole) {
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - (ORDER_TRACKING_WINDOW_DAYS - 1))

    const { data } = await supabase
      .from('vw_ordens_notas_painel')
      .select('*')
      .gte('ordem_detectada_em', cutoff.toISOString())
      .order('ordem_detectada_em', { ascending: false })
      .limit(300)

    const allRows = (data ?? []) as OrdemNotaAcompanhamento[]
    if (currentAdminRole === 'gestor') {
      ordensNotasAcompanhamento = allRows
    } else if (currentAdminRole === 'admin' && currentAdminId) {
      ordensNotasAcompanhamento = allRows.filter((row) => {
        if (row.responsavel_atual_id === currentAdminId) return true
        if (row.administrador_id === currentAdminId) return true
        return (row.envolvidos_admin_ids ?? []).includes(currentAdminId)
      })
    }
  }

  const acompanhamentoPorAdmin = ordensAcompanhamento.reduce<Map<string, number>>((acc, item) => {
    const key = item.administrador_id
    acc.set(key, (acc.get(key) ?? 0) + 1)
    return acc
  }, new Map())

  // Mostra quem recebe distribuicao, esta indisponivel, ou tem notas atribuidas
  const adminIds = new Set(notas.map((n) => n.administrador_id).filter(Boolean))
  const visiveis = admins.filter(
    (a) => a.recebe_distribuicao || !a.ativo || a.em_ferias || adminIds.has(a.id)
  )

  // Ordena: disponiveis primeiro, indisponiveis ao final
  const sorted = [...visiveis].sort((a, b) => {
    const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
    const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return 0
  })
  const collaborators = sorted.map((a) => toCollaboratorData(a, notas, acompanhamentoPorAdmin.get(a.id) ?? 0))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel de Ordens</h1>
        <p className="text-sm text-muted-foreground">
          Ordens de manutencao por tecnico
        </p>
      </div>

      {(currentAdminRole === 'admin' || currentAdminRole === 'gestor') && (
        <OrdersAgingTable
          rows={ordensNotasAcompanhamento}
          title={currentAdminRole === 'gestor' ? 'Ordens em acompanhamento (visao gestor)' : 'Minhas ordens em acompanhamento'}
          maxRows={10}
          showAdminColumns={currentAdminRole === 'gestor'}
        />
      )}

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notas}
        mode="viewer"
        notasSemAtribuir={notasSemAtribuir}
        currentAdminId={currentAdminId}
        currentAdminRole={currentAdminRole}
        ordensAcompanhamento={ordensAcompanhamento}
      />

      <RealtimeListener />
    </div>
  )
}
