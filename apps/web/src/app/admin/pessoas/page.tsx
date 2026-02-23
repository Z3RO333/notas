import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import { resolveAvatarUrl } from '@/lib/collaborator/avatar-presentation'
import type { CargaAdministrador, NotaPanelData } from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const

function toCargaCollaboratorData(c: CargaAdministrador, notas: NotaPanelData[]): CollaboratorData {
  const adminNotas = notas.filter((n) => n.administrador_id === c.id)
  const aging = buildAgingCounts(adminNotas)

  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    max_notas: c.max_notas,
    avatar_url: resolveAvatarUrl({ name: c.nome, avatarUrl: c.avatar_url }),
    especialidade: c.especialidade,
    recebe_distribuicao: c.recebe_distribuicao,
    em_ferias: c.em_ferias,
    qtd_nova: c.qtd_nova,
    qtd_em_andamento: c.qtd_em_andamento,
    qtd_encaminhada: c.qtd_encaminhada,
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: c.qtd_abertas,
    qtd_concluidas: c.qtd_concluidas,
    qtd_acompanhamento_ordens: 0,
  }
}

export default async function PessoasPage() {
  const supabase = await createClient()

  const [cargaResult, notasResult] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase
      .from('notas_manutencao')
      .select(NOTA_FIELDS)
      .not('administrador_id', 'is', null)
      .in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor'])
      .order('data_criacao_sap', { ascending: true }),
  ])

  const allCarga = (cargaResult.data ?? []) as CargaAdministrador[]
  const notas = (notasResult.data ?? []) as NotaPanelData[]

  const carga = allCarga

  const sorted = [...carga].sort((a, b) => {
    const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
    const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return 0
  })

  const collaborators = sorted.map((item) => toCargaCollaboratorData(item, notas))

  const totalAtivos = carga.filter((admin) => admin.ativo).length
  const recebendo = carga.filter((admin) => admin.ativo && admin.recebe_distribuicao && !admin.em_ferias).length
  const emFerias = carga.filter((admin) => admin.em_ferias).length
  const inativos = carga.filter((admin) => !admin.ativo).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gestão de Pessoas</h1>
        <p className="text-sm text-muted-foreground">
          Controle de disponibilidade, férias e carga operacional dos colaboradores.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Ativos: </span>
          <span className="font-semibold">{totalAtivos}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Recebendo notas: </span>
          <span className="font-semibold">{recebendo}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Em férias: </span>
          <span className="font-semibold">{emFerias}</span>
        </div>
        {inativos > 0 && (
          <div className="rounded-lg border px-4 py-2">
            <span className="text-muted-foreground">Inativos: </span>
            <span className="font-semibold">{inativos}</span>
          </div>
        )}
      </div>

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notas}
        mode="admin"
      />
    </div>
  )
}
