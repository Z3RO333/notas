'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

async function getGestorId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('Nao autenticado')

  const { data: admin } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (!admin || admin.role !== 'gestor') throw new Error('Sem permissao')
  return admin.id
}

async function logAudit(gestorId: string, acao: string, alvoId: string, detalhes?: Record<string, unknown>) {
  const supabase = await createClient()
  await supabase.from('admin_audit_log').insert({
    gestor_id: gestorId,
    acao,
    alvo_id: alvoId,
    detalhes: detalhes ?? null,
  })
}

export async function toggleDistribuicao(adminId: string, valor: boolean, motivo?: string) {
  const gestorId = await getGestorId()
  const supabase = await createClient()

  const { error } = await supabase
    .from('administradores')
    .update({
      recebe_distribuicao: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(gestorId, valor ? 'ativar_distribuicao' : 'desativar_distribuicao', adminId, { motivo })

  revalidatePath('/admin')
}

export async function toggleFerias(adminId: string, valor: boolean, motivo?: string) {
  const gestorId = await getGestorId()
  const supabase = await createClient()

  const { error } = await supabase
    .from('administradores')
    .update({
      em_ferias: valor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(gestorId, valor ? 'marcar_ferias' : 'retornar_ferias', adminId, { motivo })

  revalidatePath('/admin')
}

export async function atualizarMaxNotas(adminId: string, maxNotas: number) {
  const gestorId = await getGestorId()
  const supabase = await createClient()

  const { error } = await supabase
    .from('administradores')
    .update({
      max_notas: maxNotas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(gestorId, 'alterar_max_notas', adminId, { max_notas: maxNotas })

  revalidatePath('/admin')
}

export async function toggleAtivo(adminId: string, valor: boolean, motivo?: string) {
  const gestorId = await getGestorId()
  const supabase = await createClient()

  const { error } = await supabase
    .from('administradores')
    .update({
      ativo: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(gestorId, valor ? 'ativar_admin' : 'desativar_admin', adminId, { motivo })

  revalidatePath('/admin')
}
