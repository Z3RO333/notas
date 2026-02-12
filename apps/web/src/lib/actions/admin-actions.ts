'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type BulkReassignMode = 'destino_unico' | 'round_robin'

interface ReassignOrderRow {
  nota_id: string
  administrador_destino_id: string
}

async function getGestorContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('Nao autenticado')

  const { data: admin } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (!admin || admin.role !== 'gestor') throw new Error('Sem permissao')
  return { supabase, gestorId: admin.id }
}

function revalidateCockpitPaths() {
  revalidatePath('/')
  revalidatePath('/ordens')
  revalidatePath('/admin')
  revalidatePath('/admin/distribuicao')
  revalidatePath('/admin/auditoria')
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gestorId: string,
  acao: string,
  alvoId: string | null,
  detalhes?: Record<string, unknown>
) {
  await supabase.from('admin_audit_log').insert({
    gestor_id: gestorId,
    acao,
    alvo_id: alvoId,
    detalhes: detalhes ?? null,
  })
}

export async function toggleDistribuicao(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, gestorId } = await getGestorContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      recebe_distribuicao: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(supabase, gestorId, valor ? 'ativar_distribuicao' : 'desativar_distribuicao', adminId, { motivo })

  revalidateCockpitPaths()
}

export async function toggleFerias(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, gestorId } = await getGestorContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      em_ferias: valor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(supabase, gestorId, valor ? 'marcar_ferias' : 'retornar_ferias', adminId, { motivo })

  revalidateCockpitPaths()
}

export async function atualizarMaxNotas(adminId: string, maxNotas: number) {
  const { supabase, gestorId } = await getGestorContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      max_notas: maxNotas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(supabase, gestorId, 'alterar_max_notas', adminId, { max_notas: maxNotas })

  revalidateCockpitPaths()
}

export async function toggleAtivo(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, gestorId } = await getGestorContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      ativo: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await logAudit(supabase, gestorId, valor ? 'ativar_admin' : 'desativar_admin', adminId, { motivo })

  revalidateCockpitPaths()
}

export async function reatribuirNotasLote(params: {
  adminOrigemId: string
  modo: BulkReassignMode
  adminDestinoId?: string
  motivo?: string
}) {
  const { supabase, gestorId } = await getGestorContext()

  const { data, error } = await supabase.rpc('reatribuir_notas_lote', {
    p_admin_origem: params.adminOrigemId,
    p_gestor_id: gestorId,
    p_modo: params.modo,
    p_admin_destino: params.adminDestinoId ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  const movedCount = data?.length ?? 0

  await logAudit(supabase, gestorId, 'reatribuir_lote', params.adminOrigemId, {
    modo: params.modo,
    admin_destino_id: params.adminDestinoId ?? null,
    motivo: params.motivo ?? null,
    notas_reatribuidas: movedCount,
  })

  revalidateCockpitPaths()
  return movedCount
}

export async function reatribuirOrdensSelecionadas(params: {
  notaIds: string[]
  modo: BulkReassignMode
  adminDestinoId?: string
  motivo?: string
}) {
  const { supabase, gestorId } = await getGestorContext()

  if (!params.notaIds || params.notaIds.length === 0) {
    return [] as ReassignOrderRow[]
  }

  const { data, error } = await supabase.rpc('reatribuir_ordens_selecionadas', {
    p_nota_ids: params.notaIds,
    p_gestor_id: gestorId,
    p_modo: params.modo,
    p_admin_destino: params.adminDestinoId ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  const movedRows = (data ?? []) as ReassignOrderRow[]

  await logAudit(supabase, gestorId, 'reatribuir_ordens_lote_checkbox', null, {
    modo: params.modo,
    motivo: params.motivo ?? null,
    admin_destino_id: params.adminDestinoId ?? null,
    notas_selecionadas: params.notaIds.length,
    notas_reatribuidas: movedRows.length,
    nota_ids: params.notaIds,
  })

  revalidateCockpitPaths()
  return movedRows
}
