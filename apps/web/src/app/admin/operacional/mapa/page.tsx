import { redirect } from 'next/navigation'
import { PageTitleBlock } from '@/components/shared/page-title-block'
import { OperacionalMapa } from '@/components/admin/operacional/operacional-mapa'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import { createAdminClient } from '@/lib/supabase/admin'
import type { OperacionalAdmin, OperacionalUnidade } from '@/lib/types/database'

export const dynamic = 'force-dynamic'

async function loadMapaData(): Promise<OperacionalAdmin[]> {
  const supabase = createAdminClient()

  const [operacionaisResult, unidadesResult] = await Promise.all([
    supabase
      .from('dim_operacionais')
      .select('codigo, nome, ativo, avatar_url, especialidade, created_at, updated_at')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('operacional_unidades')
      .select('id, operacional_codigo, unidade, grupo_nome')
      .order('grupo_nome')
      .order('unidade'),
  ])

  if (operacionaisResult.error) {
    console.error('[mapa] erro ao carregar operacionais:', operacionaisResult.error.message)
    return []
  }

  const unidadesByCode = new Map<string, OperacionalUnidade[]>()
  for (const u of (unidadesResult.data ?? [])) {
    const existing = unidadesByCode.get(u.operacional_codigo) ?? []
    existing.push({
      id: u.id,
      operacional_codigo: u.operacional_codigo,
      unidade: u.unidade,
      grupo_nome: u.grupo_nome,
    })
    unidadesByCode.set(u.operacional_codigo, existing)
  }

  return (operacionaisResult.data ?? [])
    .map((op) => ({
      codigo: op.codigo,
      nome: op.nome,
      ativo: op.ativo,
      avatar_url: op.avatar_url ?? null,
      especialidade: op.especialidade ?? null,
      created_at: op.created_at,
      updated_at: op.updated_at,
      unidades: unidadesByCode.get(op.codigo) ?? [],
    }))
    .filter((op) => op.unidades.length > 0)
}

export default async function OperacionalMapaPage() {
  const ctx = await getCurrentAdminContext()
  if (!ctx.isAuthenticated) redirect('/login')

  const operacionais = await loadMapaData()

  return (
    <div className="space-y-6">
      <PageTitleBlock
        title="Mapa de Cobertura"
        subtitle="Visualize quais lojas são atendidas por cada operacional."
      />
      <OperacionalMapa operacionais={operacionais} />
    </div>
  )
}
