import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AdminOperacionalSection } from '@/components/admin/dashboard/admin-operacional-section'
import { AdminOrdersSectionSkeleton } from '@/components/admin/dashboard/admin-orders-section-skeleton'
import { OperacionalFilter } from '@/components/admin/dashboard/operacional-filter'
import { DashboardHeaderActions } from '@/components/dashboard/dashboard-header-actions'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import {
  buildOperacionalYearOptions,
  resolveOperacionalDashboardPeriod,
  type OperacionalDashboardSearchParams,
} from '@/lib/dashboard/operacional-period'
import { readFirstParam } from '@/lib/grid/query'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface OperacionalPageProps {
  searchParams?: Promise<OperacionalDashboardSearchParams & { fornecedor?: string | string[]; especialidade?: string | string[] }>
}

interface OperacionalFilterRow {
  codigo: string
  nome: string
  avatar_url?: string | null
  especialidade?: string | null
}

function includesToken(haystack: string | null | undefined, token: string): boolean {
  return (haystack ?? '').toLowerCase().includes(token.toLowerCase())
}

function isMissingSelectColumnSupport(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null,
  columnName: string,
): boolean {
  if (!error) return false

  return (
    error.code === 'PGRST204'
    || error.code === '42703'
    || includesToken(error.message, columnName)
    || includesToken(error.details, columnName)
    || includesToken(error.hint, columnName)
  )
}

async function loadOperacionais(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ operacionais: OperacionalFilterRow[]; supportsEspecialidade: boolean }> {
  const withEspecialidade = await supabase
    .from('dim_operacionais')
    .select('codigo, nome, avatar_url, especialidade')
    .eq('ativo', true)
    .order('nome')

  if (!withEspecialidade.error) {
    return {
      operacionais: (withEspecialidade.data ?? []) as OperacionalFilterRow[],
      supportsEspecialidade: true,
    }
  }

  if (!isMissingSelectColumnSupport(withEspecialidade.error, 'especialidade')) {
    console.error('[admin/operacional] Falha ao carregar dim_operacionais:', withEspecialidade.error.message)
    return { operacionais: [], supportsEspecialidade: false }
  }

  const fallback = await supabase
    .from('dim_operacionais')
    .select('codigo, nome, avatar_url')
    .eq('ativo', true)
    .order('nome')

  if (fallback.error) {
    console.error('[admin/operacional] Fallback sem especialidade tambem falhou:', fallback.error.message)
    return { operacionais: [], supportsEspecialidade: false }
  }

  console.warn('[admin/operacional] Coluna dim_operacionais.especialidade indisponivel; carregando painel sem filtro por tipo.')

  return {
    operacionais: (fallback.data ?? []).map((row) => ({
      ...(row as Omit<OperacionalFilterRow, 'especialidade'>),
      especialidade: null,
    })),
    supportsEspecialidade: false,
  }
}

export default async function OperacionalPage({ searchParams }: OperacionalPageProps) {
  const currentAdminContext = await getCurrentAdminContext()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const period = resolveOperacionalDashboardPeriod(resolvedSearchParams)
  const fornecedorCodigo = readFirstParam(resolvedSearchParams?.fornecedor) ?? null
  const especialidade = readFirstParam(resolvedSearchParams?.especialidade) ?? null
  const yearOptions = buildOperacionalYearOptions()

  if (!currentAdminContext.isAuthenticated) {
    redirect('/login')
  }

  if (!currentAdminContext.isGestor) {
    redirect('/')
  }

  const supabase = await createClient()
  const { operacionais, supportsEspecialidade } = await loadOperacionais(supabase)
  const activeEspecialidade = supportsEspecialidade ? especialidade : null

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Filtros do painel
            </p>
            <p className="text-sm text-muted-foreground">
              Ajuste colaborador e periodo sem ocupar a area principal da leitura.
            </p>
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            <OperacionalFilter
              operacionais={operacionais}
              selectedFornecedor={fornecedorCodigo}
              selectedEspecialidade={activeEspecialidade}
              selectedYear={period.year}
              selectedMonth={period.month}
              yearOptions={yearOptions}
              supportsEspecialidade={supportsEspecialidade}
            />
            <DashboardHeaderActions />
          </div>
        </div>
      </div>

      <Suspense fallback={<AdminOrdersSectionSkeleton title="Operacional" />}>
        <AdminOperacionalSection
          period={period}
          fornecedorCodigo={fornecedorCodigo}
          especialidade={activeEspecialidade}
          avatarByCode={Object.fromEntries(
            operacionais
              .filter((o) => o.avatar_url)
              .map((o) => [o.codigo, o.avatar_url as string]),
          )}
        />
      </Suspense>
    </div>
  )
}
