'use server'

import {
  getAuthenticatedAdminActionContext,
  getGestorActionContext,
  revalidateCockpitPaths,
  writeAdminAuditLog,
} from '@/lib/actions/admin-action-support'

export async function atualizarStatusNota(params: {
  notaId: string
  novoStatus: 'em_andamento' | 'encaminhada_fornecedor' | 'concluida' | 'cancelada'
  ordemGerada?: string
  fornecedorEncaminhado?: string
  observacoes?: string
  motivo?: string
}) {
  const { supabase, admin } = await getAuthenticatedAdminActionContext()

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
  const { supabase, admin } = await getAuthenticatedAdminActionContext()
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

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: 'reatribuir_nota',
    alvoId: params.novoAdminId,
    detalhes: {
      nota_id: params.notaId,
      novo_admin_id: params.novoAdminId,
      motivo: params.motivo ?? null,
    },
  })

  revalidateCockpitPaths()
}

export async function concluirNotaRapida(params: {
  notaId: string
}) {
  const { supabase, admin } = await getAuthenticatedAdminActionContext()

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
  const { supabase } = await getGestorActionContext()

  const { data, error } = await supabase.rpc('distribuir_notas', {
    p_sync_id: null,
  })

  if (error) throw new Error(error.message)

  revalidateCockpitPaths()

  return data?.length ?? 0
}

export async function buscarCodigosAvaliadas(params: {
  startIso: string
  endExclusiveIso: string
  adminId?: string | null
}): Promise<string[]> {
  const { supabase } = await getAuthenticatedAdminActionContext()
  const AVALIADAS_RAW_STATUS = ['EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA']
  const PAGE_SIZE = 1000

  const codes: string[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from('vw_ordens_notas_painel')
      .select('ordem_codigo')
      .gte('ordem_detectada_em', params.startIso)
      .lt('ordem_detectada_em', params.endExclusiveIso)
      .in('status_ordem_raw', AVALIADAS_RAW_STATUS)
      .order('ordem_codigo', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (params.adminId) {
      query = query.eq('responsavel_atual_id', params.adminId)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const batch = (data ?? []) as Array<{ ordem_codigo: string | null }>
    for (const row of batch) {
      const code = (row.ordem_codigo ?? '').trim()
      if (code) codes.push(code)
    }
    if (batch.length < PAGE_SIZE) break
  }

  return Array.from(new Set(codes))
}
