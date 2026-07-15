'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'

export interface OperacionalCoberturaRow {
  codigo: string
  nome: string
  avatar_url: string | null
  especialidade: string | null
  unidades: Array<{ unidade: string; grupo_nome: string | null }>
}

export async function buscarCoberturaOperacional(): Promise<OperacionalCoberturaRow[]> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')

  const supabase = createAdminClient()

  const [opResult, unidadesResult] = await Promise.all([
    supabase
      .from('dim_operacionais')
      .select('codigo, nome, avatar_url, especialidade')
      .eq('ativo', true)
      .order('nome'),
    supabase
      .from('operacional_unidades')
      .select('operacional_codigo, unidade, grupo_nome')
      .order('grupo_nome')
      .order('unidade'),
  ])

  if (opResult.error) throw opResult.error

  const unidadesByCode = new Map<string, Array<{ unidade: string; grupo_nome: string | null }>>()
  for (const u of (unidadesResult.data ?? [])) {
    const existing = unidadesByCode.get(u.operacional_codigo) ?? []
    existing.push({ unidade: u.unidade, grupo_nome: u.grupo_nome })
    unidadesByCode.set(u.operacional_codigo, existing)
  }

  return (opResult.data ?? [])
    .map((op) => ({
      codigo: op.codigo,
      nome: op.nome,
      avatar_url: op.avatar_url ?? null,
      especialidade: op.especialidade ?? null,
      unidades: unidadesByCode.get(op.codigo) ?? [],
    }))
    .filter((op) => op.unidades.length > 0)
}
