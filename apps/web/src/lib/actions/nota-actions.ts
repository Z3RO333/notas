'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

function revalidateCockpitPaths() {
  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/admin/distribuicao')
  revalidatePath('/admin/auditoria')
}

async function getLoggedAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) throw new Error('Nao autenticado')

  const { data: admin } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('email', user.email)
    .single()

  if (!admin) throw new Error('Administrador nao encontrado')

  return { supabase, admin }
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gestorId: string,
  alvoId: string | null,
  detalhes: Record<string, unknown>
) {
  await supabase.from('admin_audit_log').insert({
    gestor_id: gestorId,
    acao: 'reatribuir_nota',
    alvo_id: alvoId,
    detalhes,
  })
}

export async function atualizarStatusNota(params: {
  notaId: string
  novoStatus: 'em_andamento' | 'encaminhada_fornecedor' | 'concluida' | 'cancelada'
  ordemGerada?: string
  fornecedorEncaminhado?: string
  observacoes?: string
  motivo?: string
}) {
  const { supabase, admin } = await getLoggedAdmin()

  const { error } = await supabase.rpc('atualizar_status_nota', {
    p_nota_id: params.notaId,
    p_novo_status: params.novoStatus,
    p_admin_id: admin.id,
    p_ordem_gerada: params.ordemGerada ?? null,
    p_fornecedor_encaminhado: params.fornecedorEncaminhado ?? null,
    p_observacoes: params.observacoes ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  revalidateCockpitPaths()
}

export async function reatribuirNota(params: {
  notaId: string
  novoAdminId: string
  motivo?: string
}) {
  const { supabase, admin } = await getLoggedAdmin()
  if (admin.role !== 'gestor') {
    throw new Error('Sem permissao: apenas gestor pode reatribuir notas')
  }

  const { error } = await supabase.rpc('reatribuir_nota', {
    p_nota_id: params.notaId,
    p_novo_admin_id: params.novoAdminId,
    p_gestor_id: admin.id,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  await logAudit(supabase, admin.id, params.novoAdminId, {
    nota_id: params.notaId,
    novo_admin_id: params.novoAdminId,
    motivo: params.motivo ?? null,
  })

  revalidateCockpitPaths()
}

export async function concluirNotaRapida(params: {
  notaId: string
}) {
  const { supabase, admin } = await getLoggedAdmin()

  const { error } = await supabase.rpc('atualizar_status_nota', {
    p_nota_id: params.notaId,
    p_novo_status: 'concluida',
    p_admin_id: admin.id,
    p_ordem_gerada: null,
    p_fornecedor_encaminhado: null,
    p_observacoes: null,
    p_motivo: 'Conclusao rapida pelo painel',
  })

  if (error) throw new Error(error.message)

  revalidateCockpitPaths()
}

export async function distribuirNotasManual() {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('distribuir_notas', {
    p_sync_id: null,
  })

  if (error) throw new Error(error.message)

  revalidateCockpitPaths()

  return data?.length ?? 0
}
