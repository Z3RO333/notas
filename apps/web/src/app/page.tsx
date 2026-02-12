import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import type { NotaPanelData, Especialidade } from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const ADMIN_FIELDS = 'id, nome, ativo, max_notas, avatar_url, especialidade, recebe_distribuicao, em_ferias, role' as const
const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap' as const

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

const OPEN_STATUSES = new Set(['nova', 'em_andamento', 'encaminhada_fornecedor'])

function toCollaboratorData(admin: AdminRow, notas: NotaPanelData[]): CollaboratorData {
  const adminNotas = notas.filter((n) => n.administrador_id === admin.id)
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
    qtd_abertas: adminNotas.filter((n) => n.status !== 'concluida' && n.status !== 'cancelada').length,
    qtd_concluidas: adminNotas.filter((n) => n.status === 'concluida').length,
  }
}

export default async function PainelPage() {
  const supabase = await createClient()

  const [adminsResult, notasResult, semAtribuirResult] = await Promise.all([
    supabase
      .from('administradores')
      .select(ADMIN_FIELDS)
      .eq('role', 'admin')
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

  // Ordena: disponiveis primeiro, indisponiveis ao final
  const sorted = [...admins].sort((a, b) => {
    const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
    const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return 0
  })
  const collaborators = sorted.map((a) => toCollaboratorData(a, notas))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel de Ordens</h1>
        <p className="text-sm text-muted-foreground">
          Ordens de manutencao por tecnico
        </p>
      </div>

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notas}
        mode="viewer"
        notasSemAtribuir={notasSemAtribuir}
      />

      <RealtimeListener />
    </div>
  )
}
