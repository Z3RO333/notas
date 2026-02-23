'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { applyAutomaticOrdersRouting } from '@/lib/orders/pmpl-routing'
import type { Especialidade } from '@/lib/types/database'

type BulkReassignMode = 'destino_unico' | 'round_robin'

interface ReassignOrderRow {
  nota_id: string
  administrador_destino_id: string
}

interface SalvarPessoaAdminParams {
  id?: string
  nome: string
  email: string
  role: 'admin' | 'gestor'
  especialidade: Especialidade
  ativo: boolean
  emFerias: boolean
  dataInicioFerias?: string | null
  dataFimFerias?: string | null
}

interface SalvarConfigResponsavelPmplParams {
  responsavelId: string
  substitutoId?: string | null
}

async function getGestorContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('Não autenticado')

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
  revalidatePath('/admin/administracao')
  revalidatePath('/admin/distribuicao')
  revalidatePath('/admin/pessoas')
  revalidatePath('/admin/auditoria')
}

function normalizeDateInput(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function isMissingRpcFunctionError(
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined,
  functionName: string
): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return haystack.includes(functionName.toLowerCase()) && (haystack.includes('not found') || haystack.includes('does not exist'))
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gestorId: string,
  acao: string,
  alvoId: string | null,
  detalhes?: Record<string, unknown>
) {
  const { error } = await supabase.from('admin_audit_log').insert({
    gestor_id: gestorId,
    acao,
    alvo_id: alvoId,
    detalhes: detalhes ?? null,
  })

  // Auditoria não deve interromper o fluxo principal da operação.
  if (error) {
    console.error('Falha ao gravar admin_audit_log:', error.message)
  }
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

  try {
    await applyAutomaticOrdersRouting({
      supabase,
      gestorId,
      debug: process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1',
      motivo: 'Auto realocação PMPL/CD após alteração de férias',
    })
  } catch (routingError) {
    console.error('Falha ao aplicar auto realocação após férias:', routingError)
  }

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
  const uniqueNotaIds = Array.from(
    new Set((params.notaIds ?? []).filter((id): id is string => Boolean(id && id.trim())))
  )

  if (uniqueNotaIds.length === 0) {
    return {
      rows: [] as ReassignOrderRow[],
      movedCount: 0,
      skippedCount: 0,
    }
  }

  const { data, error } = await supabase.rpc('reatribuir_ordens_selecionadas', {
    p_nota_ids: uniqueNotaIds,
    p_gestor_id: gestorId,
    p_modo: params.modo,
    p_admin_destino: params.adminDestinoId ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  const movedRows = (data ?? []) as ReassignOrderRow[]
  const movedCount = movedRows.length
  const skippedCount = Math.max(uniqueNotaIds.length - movedCount, 0)

  await logAudit(supabase, gestorId, 'reatribuir_ordens_lote_checkbox', null, {
    modo: params.modo,
    motivo: params.motivo ?? null,
    admin_destino_id: params.adminDestinoId ?? null,
    notas_selecionadas: uniqueNotaIds.length,
    notas_reatribuidas: movedCount,
    notas_puladas: skippedCount,
    nota_ids_amostra: uniqueNotaIds.slice(0, 200),
  })

  revalidateCockpitPaths()
  return {
    rows: movedRows,
    movedCount,
    skippedCount,
  }
}

export async function salvarPessoaAdmin(params: SalvarPessoaAdminParams) {
  const { supabase, gestorId } = await getGestorContext()
  const nome = params.nome.trim()
  const email = params.email.trim().toLowerCase()
  const role = params.role

  if (!nome) throw new Error('Nome é obrigatório')
  if (!email) throw new Error('Email é obrigatório')
  if (role !== 'admin' && role !== 'gestor') throw new Error('Cargo inválido')

  const dataInicioFerias = normalizeDateInput(params.dataInicioFerias)
  const dataFimFerias = normalizeDateInput(params.dataFimFerias)
  if (dataInicioFerias && dataFimFerias && dataFimFerias < dataInicioFerias) {
    throw new Error('Data fim de férias não pode ser menor que a data início')
  }

  const payload = {
    nome,
    email,
    role,
    especialidade: params.especialidade,
    ativo: params.ativo,
    em_ferias: params.emFerias,
    data_inicio_ferias: dataInicioFerias,
    data_fim_ferias: dataFimFerias,
    updated_at: new Date().toISOString(),
  }

  let targetId = params.id ?? null
  if (targetId) {
    const { data, error } = await supabase
      .from('administradores')
      .update(payload)
      .eq('id', targetId)
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    targetId = data.id
  } else {
    const { data, error } = await supabase
      .from('administradores')
      .insert({
        ...payload,
        max_notas: 50,
        recebe_distribuicao: false,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    targetId = data.id
  }

  await logAudit(supabase, gestorId, 'salvar_pessoa_admin', targetId, {
    nome,
    email,
    role,
    especialidade: params.especialidade,
    ativo: params.ativo,
    em_ferias: params.emFerias,
    data_inicio_ferias: dataInicioFerias,
    data_fim_ferias: dataFimFerias,
  })

  try {
    await applyAutomaticOrdersRouting({
      supabase,
      gestorId,
      debug: process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1',
      motivo: 'Auto realocação PMPL/CD após atualização de pessoa',
    })
  } catch (routingError) {
    console.error('Falha ao aplicar auto realocação após salvar pessoa:', routingError)
  }

  revalidateCockpitPaths()
  return { id: targetId }
}

export async function salvarConfigResponsavelPmpl(params: SalvarConfigResponsavelPmplParams) {
  const { supabase, gestorId } = await getGestorContext()
  const responsavelId = params.responsavelId?.trim()
  const substitutoId = params.substitutoId?.trim() || null

  if (!responsavelId) throw new Error('Responsável PMPL é obrigatório')
  if (substitutoId && substitutoId === responsavelId) {
    throw new Error('Substituto deve ser diferente do responsável')
  }

  const ids = [responsavelId, substitutoId].filter((item): item is string => Boolean(item))
  const { data: admins, error: adminsError } = await supabase
    .from('administradores')
    .select('id, nome, ativo')
    .in('id', ids)

  if (adminsError) throw new Error(adminsError.message)

  const adminById = new Map((admins ?? []).map((item) => [item.id, item]))
  const responsavel = adminById.get(responsavelId)
  if (!responsavel) throw new Error('Responsável PMPL não encontrado')
  if (!responsavel.ativo) throw new Error('Responsável PMPL precisa estar ativo')

  if (substitutoId) {
    const substituto = adminById.get(substitutoId)
    if (!substituto) throw new Error('Substituto PMPL não encontrado')
    if (!substituto.ativo) throw new Error('Substituto PMPL precisa estar ativo')
  }

  const { data: beforeData, error: beforeError } = await supabase
    .from('responsaveis_tipo_ordem')
    .select('tipo_ordem, responsavel_id, substituto_id')
    .eq('tipo_ordem', 'PMPL')
    .maybeSingle()

  if (beforeError && beforeError.code !== 'PGRST116') {
    throw new Error(beforeError.message)
  }

  const { data: afterData, error: upsertError } = await supabase
    .from('responsaveis_tipo_ordem')
    .upsert({
      tipo_ordem: 'PMPL',
      responsavel_id: responsavelId,
      substituto_id: substitutoId,
      atualizado_por: gestorId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tipo_ordem' })
    .select('tipo_ordem, responsavel_id, substituto_id')
    .single()

  if (upsertError) throw new Error(upsertError.message)

  const { error: auditConfigError } = await supabase
    .from('auditoria_config')
    .insert({
      tipo: 'responsaveis_tipo_ordem_pmpl',
      antes: beforeData ?? null,
      depois: afterData ?? null,
      atualizado_por: gestorId,
    })

  if (auditConfigError) {
    console.error('Falha ao gravar auditoria_config:', auditConfigError.message)
  }

  await logAudit(supabase, gestorId, 'salvar_responsavel_pmpl', responsavelId, {
    antes: beforeData ?? null,
    depois: afterData ?? null,
  })

  try {
    await applyAutomaticOrdersRouting({
      supabase,
      gestorId,
      debug: process.env.DEBUG_ORDERS_ROUTING === '1' || process.env.DEBUG_ORDERS_CD_ROUTING === '1',
      motivo: 'Auto realocação PMPL/CD após atualização da configuração PMPL',
    })
  } catch (routingError) {
    console.error('Falha ao aplicar auto realocação após salvar configuração PMPL:', routingError)
  }

  try {
    const { error: realignError } = await supabase.rpc('realinhar_responsavel_pmpl_standalone')
    if (realignError && !isMissingRpcFunctionError(realignError, 'realinhar_responsavel_pmpl_standalone')) {
      console.error('Falha ao realinhar PMPL standalone após salvar configuração PMPL:', realignError.message)
    }
  } catch (realignError) {
    console.error('Falha ao executar RPC de realinhamento PMPL standalone:', realignError)
  }

  revalidateCockpitPaths()
  return afterData
}
