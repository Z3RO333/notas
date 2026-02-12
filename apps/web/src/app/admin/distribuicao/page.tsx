import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import type { CargaAdministrador, NotaPanelData } from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap' as const

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

export default async function DistribuicaoPage() {
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

  const carga = cargaResult.data ?? []
  const notas = (notasResult.data ?? []) as NotaPanelData[]

  const ativos = carga.filter((a) => a.ativo && a.recebe_distribuicao)
  const collaborators = ativos.map(toCargaCollaboratorData)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gestao da Distribuicao</h1>
        <p className="text-sm text-muted-foreground">
          Controle quem recebe notas, ferias e limites de carga
        </p>
      </div>

      {/* Resumo */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Ativos: </span>
          <span className="font-semibold">{ativos.length}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Recebendo notas: </span>
          <span className="font-semibold">{ativos.filter((a) => a.recebe_distribuicao && !a.em_ferias).length}</span>
        </div>
        <div className="rounded-lg border px-4 py-2">
          <span className="text-muted-foreground">Em ferias: </span>
          <span className="font-semibold">{ativos.filter((a) => a.em_ferias).length}</span>
        </div>
      </div>

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notas}
        mode="admin"
      />
    </div>
  )
}
