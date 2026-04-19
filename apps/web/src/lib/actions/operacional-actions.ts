'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'

async function assertGestor() {
  const supabase = await createClient()
  const ctx = await getCurrentAdminContext()
  if (!ctx.isAuthenticated || !ctx.adminId) throw new Error('Nao autenticado')
  if (ctx.role !== 'gestor') throw new Error('Apenas gestores podem gerenciar operacionais')
  return { supabase, ctx }
}

export interface SalvarOperacionalParams {
  codigo: string
  nome: string
  ativo: boolean
  especialidade: string | null
}

export async function salvarOperacionalAdmin(params: SalvarOperacionalParams) {
  await assertGestor()

  const adminDb = createAdminClient()
  const codigo = params.codigo.trim()
  const nome = params.nome.trim()

  if (!codigo) throw new Error('Codigo e obrigatorio')
  if (!nome) throw new Error('Nome e obrigatorio')

  const { error } = await adminDb
    .from('dim_operacionais')
    .upsert(
      {
        codigo,
        nome,
        ativo: params.ativo,
        especialidade: params.especialidade || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'codigo' },
    )

  if (error) throw new Error(error.message)

  revalidatePath('/admin/administracao')
  revalidatePath('/admin/operacional/mapa')
}

export async function salvarUnidadesOperacional(
  operacionalCodigo: string,
  unidades: Array<{ unidade: string; grupo_nome: string | null }>,
) {
  await assertGestor()

  const adminDb = createAdminClient()
  const codigo = operacionalCodigo.trim()
  if (!codigo) throw new Error('Codigo do operacional e obrigatorio')

  const { error: deleteError } = await adminDb
    .from('operacional_unidades')
    .delete()
    .eq('operacional_codigo', codigo)

  if (deleteError) throw new Error(deleteError.message)

  if (unidades.length > 0) {
    const { error: insertError } = await adminDb
      .from('operacional_unidades')
      .insert(
        unidades.map((u) => ({
          operacional_codigo: codigo,
          unidade: u.unidade.trim(),
          grupo_nome: u.grupo_nome?.trim() || null,
        })),
      )

    if (insertError) throw new Error(insertError.message)
  }

  revalidatePath('/admin/administracao')
  revalidatePath('/admin/operacional/mapa')
}
