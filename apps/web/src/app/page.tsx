import { createClient } from '@/lib/supabase/server'
import { CollaboratorPanel } from '@/components/collaborator/collaborator-panel'
import { NotasKpiStrip } from '@/components/notas/notas-kpi-strip'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { buildAgingCounts } from '@/lib/collaborator/metrics'
import { isOpenStatus } from '@/lib/collaborator/aging'
import { normalizeTextParam, readFirstParam } from '@/lib/grid/query'
import type {
  CargaAdministrador,
  NotesKpiFilter,
  NotaPanelData,
  UserRole,
} from '@/lib/types/database'
import type { CollaboratorData } from '@/lib/types/collaborator'

export const dynamic = 'force-dynamic'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'
const VALID_NOTES_KPI: NotesKpiFilter[] = ['notas', 'novas', 'um_dia', 'dois_mais']
const GUSTAVO_EMAIL = 'gustavoandrade@bemol.com.br'

interface NotesPageProps {
  searchParams?: Promise<{
    q?: string | string[]
    status?: string | string[]
    responsavel?: string | string[]
    unidade?: string | string[]
    kpi?: string | string[]
  }>
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

function toCargaCollaboratorData(c: CargaAdministrador, notas: NotaPanelData[]): CollaboratorData {
  const adminNotas = notas.filter((n) => n.administrador_id === c.id)
  const aging = buildAgingCounts(adminNotas)

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
    qtd_novo: aging.qtd_novo,
    qtd_1_dia: aging.qtd_1_dia,
    qtd_2_mais: aging.qtd_2_mais,
    qtd_abertas: c.qtd_abertas,
    qtd_concluidas: c.qtd_concluidas,
    qtd_acompanhamento_ordens: 0,
  }
}

export default async function NotesPanelPage({ searchParams }: NotesPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const { data: { user } } = await supabase.auth.getUser()

  const loggedAdminResult = user?.email
    ? await supabase
      .from('administradores')
      .select('id, role')
      .eq('email', user.email)
      .single()
    : { data: null }

  const currentAdminId = loggedAdminResult.data?.id ?? null
  const currentAdminRole = toUserRole(loggedAdminResult.data?.role)
  const canViewGlobal = currentAdminRole === 'gestor'

  const q = normalizeTextParam(readFirstParam(resolvedSearchParams?.q))
  const status = normalizeTextParam(readFirstParam(resolvedSearchParams?.status))
  const responsavel = normalizeTextParam(readFirstParam(resolvedSearchParams?.responsavel))
  const unidade = normalizeTextParam(readFirstParam(resolvedSearchParams?.unidade))
  const kpiRaw = normalizeTextParam(readFirstParam(resolvedSearchParams?.kpi))
  const activeNotesKpi = (VALID_NOTES_KPI.includes(kpiRaw as NotesKpiFilter) ? kpiRaw : '') as NotesKpiFilter | ''

  const [cargaResult, adminsResult, latestSyncResult] = await Promise.all([
    supabase.from('vw_carga_administradores').select('*').order('nome'),
    supabase
      .from('administradores')
      .select('id, nome')
      .eq('role', 'admin')
      .order('nome'),
    supabase
      .from('sync_log')
      .select('finished_at, status')
      .order('started_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  let notesQuery = supabase
    .from('vw_notas_sem_ordem')
    .select(NOTA_FIELDS)
    .order('data_criacao_sap', { ascending: true })

  if (!canViewGlobal) {
    if (!currentAdminId) {
      notesQuery = notesQuery.eq('administrador_id', EMPTY_UUID)
    } else {
      notesQuery = notesQuery.eq('administrador_id', currentAdminId)
    }
  } else if (responsavel && responsavel !== 'todos') {
    if (responsavel === 'sem_atribuir') {
      notesQuery = notesQuery.is('administrador_id', null)
    } else {
      notesQuery = notesQuery.eq('administrador_id', responsavel)
    }
  }

  if (status && status !== 'todas') {
    if (status === 'abertas') {
      notesQuery = notesQuery.in('status', ['nova', 'em_andamento', 'encaminhada_fornecedor'])
    } else {
      notesQuery = notesQuery.eq('status', status)
    }
  }

  if (unidade && unidade !== 'todas') {
    notesQuery = notesQuery.eq('centro', unidade)
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, '')
    notesQuery = notesQuery.or(`numero_nota.ilike.%${escaped}%,descricao.ilike.%${escaped}%`)
  }

  const notesResult = await notesQuery.limit(5000)

  const allCarga = (cargaResult.data ?? []) as CargaAdministrador[]
  const notasFiltradas = (notesResult.data ?? []) as NotaPanelData[]
  const notasAtribuidas = notasFiltradas.filter((nota) => Boolean(nota.administrador_id))
  const notasSemAtribuir = notasFiltradas.filter((nota) => !nota.administrador_id)

  const notaAdminIds = new Set(notasAtribuidas.map((n) => n.administrador_id).filter(Boolean) as string[])
  const carga = allCarga.filter(
    (admin) => admin.recebe_distribuicao || !admin.ativo || admin.em_ferias || admin.qtd_abertas > 0 || notaAdminIds.has(admin.id)
  ).filter((admin) => admin.email !== GUSTAVO_EMAIL)

  const collaborators = [...carga]
    .sort((a, b) => {
      const aOk = a.ativo && a.recebe_distribuicao && !a.em_ferias
      const bOk = b.ativo && b.recebe_distribuicao && !b.em_ferias
      if (aOk && !bOk) return -1
      if (!aOk && bOk) return 1
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })
    .map((item) => toCargaCollaboratorData(item, notasAtribuidas))

  const baseOpenNotas = notasFiltradas.filter((nota) => isOpenStatus(nota.status))
  const aging = buildAgingCounts(baseOpenNotas)

  const responsavelOptions = [
    { value: 'todos', label: 'Todos os responsáveis' },
    ...((adminsResult.data ?? []).map((admin) => ({ value: admin.id, label: admin.nome }))),
    { value: 'sem_atribuir', label: 'Não atribuídas' },
  ]

  const unidadeOptions = [
    { value: 'todas', label: 'Todas as unidades' },
    ...Array.from(new Set(notasFiltradas.map((nota) => nota.centro).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((centro) => ({ value: centro, label: centro })),
  ]

  const latestSync = latestSyncResult.data ?? null

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Notas"
        rightSlot={<LastSyncBadge timestamp={latestSync?.finished_at ?? null} status={latestSync?.status ?? null} />}
      />

      <NotasKpiStrip
        total={baseOpenNotas.length}
        novas={aging.qtd_novo}
        umDia={aging.qtd_1_dia}
        doisMais={aging.qtd_2_mais}
        activeKpi={activeNotesKpi || null}
      />

      <CollaboratorPanel
        collaborators={collaborators}
        notas={notasAtribuidas}
        notasSemAtribuir={canViewGlobal ? notasSemAtribuir : undefined}
        mode="viewer"
        currentAdminId={currentAdminId}
        currentAdminRole={currentAdminRole}
        syncWithUrl
        initialSearch={q}
        initialStatus={status}
        initialResponsavel={responsavel}
        initialUnidade={unidade}
        responsavelOptions={responsavelOptions}
        unidadeOptions={unidadeOptions}
        showResponsavelFilter={canViewGlobal}
        showUnidadeFilter
        activeNotesKpi={activeNotesKpi || null}
      />

      <RealtimeListener />
    </div>
  )
}
