import { createClient } from '@/lib/supabase/server'
import { NotasGrid } from '@/components/notas/notas-grid'
import { RealtimeListener } from '@/components/notas/realtime-listener'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { LastSyncBadge } from '@/components/shared/last-sync-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  parsePageParam,
  parsePageSizeParam,
  parseSortParam,
  readFirstParam,
  normalizeTextParam,
} from '@/lib/grid/query'
import type {
  GridFilterState,
  GridSortState,
  NotaPanelData,
  NotasMetrics30d,
  UserRole,
} from '@/lib/types/database'

export const dynamic = 'force-dynamic'

const NOTA_FIELDS = 'id, numero_nota, descricao, status, administrador_id, prioridade, centro, data_criacao_sap, created_at' as const
const DEFAULT_SORT: GridSortState = { field: 'data', direction: 'asc' }
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'

interface NotesPageProps {
  searchParams?: Promise<{
    q?: string | string[]
    status?: string | string[]
    responsavel?: string | string[]
    unidade?: string | string[]
    sort?: string | string[]
    page?: string | string[]
    pageSize?: string | string[]
  }>
}

function toUserRole(value: string | null | undefined): UserRole | null {
  if (value === 'admin' || value === 'gestor') return value
  return null
}

function fmtInteger(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0'
  return new Intl.NumberFormat('pt-BR').format(value)
}

function fmtFloat(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value.toFixed(1)} d`
}

function mapSortToColumns(sort: GridSortState): Array<{ column: string; ascending: boolean }> {
  if (sort.field === 'numero_nota') return [{ column: 'numero_nota', ascending: sort.direction === 'asc' }]
  if (sort.field === 'status') return [{ column: 'status', ascending: sort.direction === 'asc' }]
  if (sort.field === 'responsavel') return [{ column: 'administrador_id', ascending: sort.direction === 'asc' }]
  if (sort.field === 'idade') {
    return [
      { column: 'data_criacao_sap', ascending: true },
      { column: 'created_at', ascending: true },
    ]
  }
  return [
    { column: 'data_criacao_sap', ascending: sort.direction === 'asc' },
    { column: 'created_at', ascending: sort.direction === 'asc' },
  ]
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
  const sort = parseSortParam(readFirstParam(resolvedSearchParams?.sort), DEFAULT_SORT)
  const page = parsePageParam(readFirstParam(resolvedSearchParams?.page))
  const pageSize = parsePageSizeParam(readFirstParam(resolvedSearchParams?.pageSize), [20, 50, 100])

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const [adminsResult, latestSyncResult, notesMetricsResult] = await Promise.all([
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
    canViewGlobal
      ? supabase.from('vw_notas_metrics_30d').select('*').single()
      : Promise.resolve({ data: null }),
  ])

  const admins = adminsResult.data ?? []
  const adminNameById = new Map(admins.map((admin) => [admin.id, admin.nome]))

  let notesQuery = supabase
    .from('vw_notas_sem_ordem')
    .select(NOTA_FIELDS, { count: 'exact' })

  if (!canViewGlobal) {
    if (!currentAdminId) {
      notesQuery = notesQuery.eq('administrador_id', EMPTY_UUID)
    } else {
      notesQuery = notesQuery.eq('administrador_id', currentAdminId)
    }
  } else if (responsavel) {
    notesQuery = notesQuery.eq('administrador_id', responsavel)
  }

  if (status) {
    notesQuery = notesQuery.eq('status', status)
  }

  if (unidade) {
    notesQuery = notesQuery.eq('centro', unidade)
  }

  if (q) {
    const escaped = q.replace(/[%_]/g, '')
    notesQuery = notesQuery.or(`numero_nota.ilike.%${escaped}%,descricao.ilike.%${escaped}%`)
  }

  for (const orderRule of mapSortToColumns(sort)) {
    notesQuery = notesQuery.order(orderRule.column, { ascending: orderRule.ascending })
  }

  let unitsQuery = supabase
    .from('vw_notas_sem_ordem')
    .select('centro')
    .not('centro', 'is', null)
    .limit(1000)

  if (!canViewGlobal) {
    if (!currentAdminId) {
      unitsQuery = unitsQuery.eq('administrador_id', EMPTY_UUID)
    } else {
      unitsQuery = unitsQuery.eq('administrador_id', currentAdminId)
    }
  } else if (responsavel) {
    unitsQuery = unitsQuery.eq('administrador_id', responsavel)
  }

  if (status) {
    unitsQuery = unitsQuery.eq('status', status)
  }

  const [notesResult, unitsResult] = await Promise.all([
    notesQuery.range(from, to),
    unitsQuery,
  ])

  const notesRows = (notesResult.data ?? []) as NotaPanelData[]
  const total = notesResult.count ?? 0

  const gridRows = notesRows.map((row) => ({
    ...row,
    responsavel_nome: row.administrador_id ? (adminNameById.get(row.administrador_id) ?? null) : null,
  }))

  const unitOptions = [
    { value: 'todas', label: 'Todas as unidades' },
    ...Array.from(new Set(((unitsResult.data ?? []).map((row) => row.centro).filter(Boolean) as string[]))).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((center) => ({
      value: center,
      label: center,
    })),
  ]

  const responsavelOptions = [
    { value: 'todos', label: 'Todos os responsaveis' },
    ...admins.map((admin) => ({ value: admin.id, label: admin.nome })),
  ]

  const latestSync = latestSyncResult.data ?? null
  const notesMetrics = (notesMetricsResult.data ?? null) as NotasMetrics30d | null

  const filters: GridFilterState = {
    q,
    status,
    responsavel,
    unidade,
  }

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Painel de Notas"
        subtitle="Tratativa operacional de notas sem ordem gerada."
        rightSlot={<LastSyncBadge timestamp={latestSync?.finished_at ?? null} status={latestSync?.status ?? null} />}
      />

      {canViewGlobal && notesMetrics && (
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

      <NotasGrid
        rows={gridRows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        q={filters.q ?? ''}
        status={filters.status ?? ''}
        responsavel={filters.responsavel ?? ''}
        unidade={filters.unidade ?? ''}
        canViewGlobal={canViewGlobal}
        responsavelOptions={responsavelOptions}
        unidadeOptions={unitOptions}
      />

      <RealtimeListener />
    </div>
  )
}
