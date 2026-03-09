import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { toCollaboratorData } from '@/lib/collaborator/to-collaborator-data'
import type { CargaAdministrador, NotaPanelData } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const

export default async function PessoasPage() {
  const supabase = await createClient()

  const [cargaResult, notasResult, adminsResult] = await Promise.all([
    supabase.from('vw_carga_real_administradores').select('*').order('nome'),
    supabase
      .from('vw_notas_sem_ordem')
      .select(NOTA_FIELDS)
      .not('administrador_id', 'is', null)
      .in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor'])
      .order('data_criacao_sap', { ascending: true }),
    supabase
      .from('administradores')
      .select('id')
      .eq('role', 'admin'),
  ])

  const firstError = [cargaResult.error, notasResult.error, adminsResult.error].find(Boolean)
  if (firstError) throw firstError

  const allCarga = (cargaResult.data ?? []) as CargaAdministrador[]
  const operationalAdminIds = new Set(
    ((adminsResult.data ?? []) as Array<{ id: string }>).map((admin) => admin.id)
  )
  const notas = (notasResult.data ?? []) as NotaPanelData[]

  const carga = allCarga.filter((admin) => operationalAdminIds.has(admin.id))

  const sorted = [...carga].sort((a, b) => {
    const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
    const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return 0
  })

  const collaborators = sorted.map((item) => toCollaboratorData(item, notas, { qtdAcompanhamentoOrdens: 0 }))

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
