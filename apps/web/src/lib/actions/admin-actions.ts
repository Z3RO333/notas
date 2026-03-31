'use server'

import { BEMOL_EMAIL_DOMAIN } from '@/lib/auth/shared'
import {
  getGestorActionContext,
  getGestorOrMaintainerActionContext,
  isMissingRpcFunctionError,
  revalidateCockpitPaths,
  runBestEffortAutomaticOrdersRouting,
  runBestEffortVacationCoverageRedistribution,
  writeAdminAuditLog,
} from '@/lib/actions/admin-action-support'
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

function normalizeDateInput(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

export async function toggleDistribuicao(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, admin } = await getGestorActionContext()

  const { data: targetAdmin, error: targetAdminError } = await supabase
    .from('administradores')
    .select('id, role')
    .eq('id', adminId)
    .single()

  if (targetAdminError || !targetAdmin) throw new Error(targetAdminError?.message ?? 'Colaborador nao encontrado')
  if (targetAdmin.role === 'gestor' && valor) {
    throw new Error('Gestor nao pode receber distribuicao')
  }

  const { error } = await supabase
    .from('administradores')
    .update({
      recebe_distribuicao: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: valor ? 'ativar_distribuicao' : 'desativar_distribuicao',
    alvoId: adminId,
    detalhes: { motivo },
  })

  revalidateCockpitPaths()
}

export async function toggleFerias(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, admin } = await getGestorActionContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      em_ferias: valor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: valor ? 'marcar_ferias' : 'retornar_ferias',
    alvoId: adminId,
    detalhes: { motivo },
  })

  if (valor) {
    await runBestEffortVacationCoverageRedistribution({
      supabase,
      gestorId: admin.id,
      adminOrigemId: adminId,
      motivo: motivo ?? 'Redistribuicao automatica ao entrar de ferias',
      errorPrefix: 'Falha ao redistribuir carteira apos marcar ferias:',
    })
  }

  await runBestEffortAutomaticOrdersRouting({
    supabase,
    gestorId: admin.id,
    motivo: 'Auto realocacao PMPL/CD apos alteracao de ferias',
    errorPrefix: 'Falha ao aplicar auto realocacao apos ferias:',
  })

  revalidateCockpitPaths()
}

export async function toggleAtivo(adminId: string, valor: boolean, motivo?: string) {
  const { supabase, admin } = await getGestorActionContext()

  const { error } = await supabase
    .from('administradores')
    .update({
      ativo: valor,
      motivo_bloqueio: valor ? null : (motivo ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId)

  if (error) throw new Error(error.message)

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: valor ? 'ativar_admin' : 'desativar_admin',
    alvoId: adminId,
    detalhes: { motivo },
  })

  revalidateCockpitPaths()
}

export async function reatribuirNotasLote(params: {
  adminOrigemId: string
  modo: BulkReassignMode
  adminDestinoId?: string
  motivo?: string
}) {
  const { supabase, admin } = await getGestorActionContext()

  const { data, error } = await supabase.rpc('reatribuir_notas_lote', {
    p_admin_origem: params.adminOrigemId,
    p_gestor_id: admin.id,
    p_modo: params.modo,
    p_admin_destino: params.adminDestinoId ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  const movedCount = data?.length ?? 0

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: 'reatribuir_lote',
    alvoId: params.adminOrigemId,
    detalhes: {
      modo: params.modo,
      admin_destino_id: params.adminDestinoId ?? null,
      motivo: params.motivo ?? null,
      notas_reatribuidas: movedCount,
    },
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
  const { supabase, admin } = await getGestorActionContext()
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
    p_gestor_id: admin.id,
    p_modo: params.modo,
    p_admin_destino: params.adminDestinoId ?? null,
    p_motivo: params.motivo ?? null,
  })

  if (error) throw new Error(error.message)

  const movedRows = (data ?? []) as ReassignOrderRow[]
  const movedCount = movedRows.length
  const skippedCount = Math.max(uniqueNotaIds.length - movedCount, 0)

  await runBestEffortAutomaticOrdersRouting({
    supabase,
    gestorId: admin.id,
    motivo: params.motivo ?? 'Realinhamento automatico pos-redistribuicao manual de ordens',
    errorPrefix: 'Falha ao aplicar auto realocacao apos redistribuicao manual de ordens:',
  })

  const { data: finalAssignmentsData, error: finalAssignmentsError } = await supabase
    .from('notas_manutencao')
    .select('id, administrador_id')
    .in('id', uniqueNotaIds)

  if (finalAssignmentsError) throw new Error(finalAssignmentsError.message)

  const finalRows = ((finalAssignmentsData ?? []) as Array<{ id: string; administrador_id: string | null }>)
    .filter((row) => Boolean(row.administrador_id))
    .map((row) => ({
      nota_id: row.id,
      administrador_destino_id: row.administrador_id as string,
    }))

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: 'reatribuir_ordens_lote_checkbox',
    alvoId: null,
    detalhes: {
      modo: params.modo,
      motivo: params.motivo ?? null,
      admin_destino_id: params.adminDestinoId ?? null,
      notas_selecionadas: uniqueNotaIds.length,
      notas_reatribuidas: movedCount,
      notas_puladas: skippedCount,
      nota_ids_amostra: uniqueNotaIds.slice(0, 200),
    },
  })

  revalidateCockpitPaths()
  return {
    rows: finalRows,
    movedCount,
    skippedCount,
  }
}

export async function salvarPessoaAdmin(params: SalvarPessoaAdminParams) {
  const { supabase, admin } = await getGestorOrMaintainerActionContext()
  const nome = params.nome.trim()
  const email = params.email.trim().toLowerCase()
  const role = params.role
  if (email && !email.endsWith(BEMOL_EMAIL_DOMAIN)) {
    throw new Error(`Email deve terminar com ${BEMOL_EMAIL_DOMAIN}`)
  }

  if (!nome) throw new Error('Nome e obrigatorio')
  if (!email) throw new Error('Email e obrigatorio')
  if (role !== 'admin' && role !== 'gestor') throw new Error('Cargo invalido')

  const dataInicioFerias = normalizeDateInput(params.dataInicioFerias)
  const dataFimFerias = normalizeDateInput(params.dataFimFerias)
  if (dataInicioFerias && dataFimFerias && dataFimFerias < dataInicioFerias) {
    throw new Error('Data fim de ferias nao pode ser menor que a data inicio')
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
  let previousEmFerias = false
  if (targetId) {
    const { data: currentAdmin, error: currentAdminError } = await supabase
      .from('administradores')
      .select('id, em_ferias')
      .eq('id', targetId)
      .single()

    if (currentAdminError || !currentAdmin) {
      throw new Error(currentAdminError?.message ?? 'Pessoa nao encontrada')
    }

    previousEmFerias = Boolean(currentAdmin.em_ferias)

    const updatePayload = role === 'gestor'
      ? { ...payload, recebe_distribuicao: false }
      : payload

    const { data, error } = await supabase
      .from('administradores')
      .update(updatePayload)
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

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: 'salvar_pessoa_admin',
    alvoId: targetId,
    detalhes: {
      nome,
      email,
      role,
      especialidade: params.especialidade,
      ativo: params.ativo,
      em_ferias: params.emFerias,
      data_inicio_ferias: dataInicioFerias,
      data_fim_ferias: dataFimFerias,
    },
  })

  if (role === 'admin' && params.emFerias && targetId && !previousEmFerias) {
    await runBestEffortVacationCoverageRedistribution({
      supabase,
      gestorId: admin.id,
      adminOrigemId: targetId,
      motivo: 'Redistribuicao automatica ao salvar pessoa em ferias',
      errorPrefix: 'Falha ao redistribuir carteira apos salvar pessoa em ferias:',
    })
  }

  await runBestEffortAutomaticOrdersRouting({
    supabase,
    gestorId: admin.id,
    motivo: 'Auto realocacao PMPL/CD apos atualizacao de pessoa',
    errorPrefix: 'Falha ao aplicar auto realocacao apos salvar pessoa:',
  })

  revalidateCockpitPaths()
  return { id: targetId }
}

export async function salvarConfigResponsavelPmpl(params: SalvarConfigResponsavelPmplParams) {
  const { supabase, admin } = await getGestorOrMaintainerActionContext()
  const responsavelId = params.responsavelId?.trim()
  const substitutoId = params.substitutoId?.trim() || null

  if (!responsavelId) throw new Error('Responsavel PMPL e obrigatorio')
  if (substitutoId && substitutoId === responsavelId) {
    throw new Error('Substituto deve ser diferente do responsavel')
  }

  const ids = [responsavelId, substitutoId].filter((item): item is string => Boolean(item))
  const { data: admins, error: adminsError } = await supabase
    .from('administradores')
    .select('id, nome, ativo')
    .in('id', ids)

  if (adminsError) throw new Error(adminsError.message)

  const adminById = new Map((admins ?? []).map((item) => [item.id, item]))
  const responsavel = adminById.get(responsavelId)
  if (!responsavel) throw new Error('Responsavel PMPL nao encontrado')
  if (!responsavel.ativo) throw new Error('Responsavel PMPL precisa estar ativo')

  if (substitutoId) {
    const substituto = adminById.get(substitutoId)
    if (!substituto) throw new Error('Substituto PMPL nao encontrado')
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
      atualizado_por: admin.id,
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
      atualizado_por: admin.id,
    })

  if (auditConfigError) {
    console.error('Falha ao gravar auditoria_config:', auditConfigError.message)
  }

  await writeAdminAuditLog({
    supabase,
    gestorId: admin.id,
    acao: 'salvar_responsavel_pmpl',
    alvoId: responsavelId,
    detalhes: {
      antes: beforeData ?? null,
      depois: afterData ?? null,
    },
  })

  await runBestEffortAutomaticOrdersRouting({
    supabase,
    gestorId: admin.id,
    motivo: 'Auto realocacao PMPL/CD apos atualizacao da configuracao PMPL',
    errorPrefix: 'Falha ao aplicar auto realocacao apos salvar configuracao PMPL:',
  })

  try {
    const { error: realignError } = await supabase.rpc('realinhar_responsavel_pmpl_standalone')
    if (realignError && !isMissingRpcFunctionError(realignError, 'realinhar_responsavel_pmpl_standalone')) {
      console.error('Falha ao realinhar PMPL standalone apos salvar configuracao PMPL:', realignError.message)
    }
  } catch (realignError) {
    console.error('Falha ao executar RPC de realinhamento PMPL standalone:', realignError)
  }

  revalidateCockpitPaths()
  return afterData
}
