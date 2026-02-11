'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function atualizarStatusNota(params: {
  notaId: string
  administradorId: string
  novoStatus: 'em_andamento' | 'encaminhada_fornecedor' | 'concluida' | 'cancelada'
  ordemGerada?: string
  fornecedorEncaminhado?: string
  observacoes?: string
  motivo?: string
}) {
  const supabase = createClient()

  const { error } = await supabase.rpc('atualizar_status_nota', {
    p_nota_id: params.notaId,
    p_novo_status: params.novoStatus,
    p_admin_id: params.administradorId,
    p_ordem_gerada: params.ordemGerada ?? null,
    p_fornecedor_encaminhado: params.fornecedorEncaminhado ?? null,
    p_observacoes: params.observacoes ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  revalidatePath('/')
  revalidatePath('/gestor')
}

export async function reatribuirNota(params: {
  notaId: string
  novoAdminId: string
  gestorId: string
  motivo?: string
}) {
  const supabase = createClient()

  const { error } = await supabase.rpc('reatribuir_nota', {
    p_nota_id: params.notaId,
    p_novo_admin_id: params.novoAdminId,
    p_gestor_id: params.gestorId,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  revalidatePath('/')
  revalidatePath('/gestor')
}

export async function concluirNotaRapida(params: {
  notaId: string
  administradorId: string
}) {
  const supabase = createClient()

  const { error } = await supabase.rpc('atualizar_status_nota', {
    p_nota_id: params.notaId,
    p_novo_status: 'concluida',
    p_admin_id: params.administradorId,
    p_ordem_gerada: null,
    p_fornecedor_encaminhado: null,
    p_observacoes: null,
    p_motivo: 'Conclusao rapida pelo painel',
  })

  if (error) throw new Error(error.message)

  revalidatePath('/')
  revalidatePath('/gestor')
}

export async function distribuirNotasManual() {
  const supabase = createClient()

  const { data, error } = await supabase.rpc('distribuir_notas', {
    p_sync_id: null,
  })

  if (error) throw new Error(error.message)

  revalidatePath('/')
  revalidatePath('/gestor')

  return data?.length ?? 0
}
