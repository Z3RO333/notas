'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'
import { getAuthenticatedAdminActionContext } from '@/lib/actions/admin-action-support'
import {
  buildPublishRoutePayload,
  type ReassignRouteOrderPayload,
  type ReassignRouteOrderResponse,
} from '@/lib/saidas/rota-integration'
import type {
  CriarSaidaOrdemInput,
  RotaDispatchStatus,
  RotaDispatchSummary,
  SaidaOrdemResultado,
} from '@/lib/types/saidas'

type PublishRotaResult = {
  data: RotaDispatchSummary | null
  error: string | null
}

interface RedistribuirOrdemInput {
  saidaOrdemId: string
  novoOperacionalCodigo: string
  motivo: string
}

interface RedistribuirOrdemResult {
  data: { commandId: string; targetSaidaId: string } | null
  error: string | null
}

interface RedistribuicaoCommand {
  command_id: string
  idempotency_key: string
  status: 'pending' | 'processing' | 'failed' | 'completed' | 'cancelled'
  source_cockpit_cargo_id: string
  target_cockpit_cargo_id: string
  source_operational_code: string
  target_operational_code: string
  target_rota_operational_id: string
  order_number: string
  reason: string
  planned_date: string
  attempt_count: number
  next_retry_at: string | null
  rota_transfer_id: string | null
  sap_sync_status: 'not_requested'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseRedistribuicaoCommand(value: unknown): RedistribuicaoCommand {
  const row = (Array.isArray(value) ? value[0] : value) as Partial<RedistribuicaoCommand> | null
  if (
    !row
    || typeof row.command_id !== 'string'
    || typeof row.idempotency_key !== 'string'
    || typeof row.source_cockpit_cargo_id !== 'string'
    || typeof row.target_cockpit_cargo_id !== 'string'
    || typeof row.target_operational_code !== 'string'
    || typeof row.target_rota_operational_id !== 'string'
    || typeof row.order_number !== 'string'
    || typeof row.reason !== 'string'
    || typeof row.planned_date !== 'string'
  ) {
    throw new Error('O banco retornou uma redistribuição inválida')
  }

  return row as RedistribuicaoCommand
}

function getRotaApiUrl(): string {
  const value = process.env.ROTA_API_URL?.trim().replace(/\/$/, '')
  if (!value) throw new Error('ROTA_API_URL não configurada no Cockpit')

  const url = new URL(value)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('ROTA_API_URL deve usar HTTPS em produção')
  }

  return url.toString().replace(/\/$/, '')
}

function getRotaIntegrationSecret(): string {
  const value = process.env.ROTA_INTEGRATION_SECRET?.trim()
  if (!value) throw new Error('ROTA_INTEGRATION_SECRET não configurada no Cockpit')
  return value
}

export async function criarSaidaOperacional(
  operacionalCodigo: string,
  dataSaida: string,
  observacao: string | null,
  ordens: CriarSaidaOrdemInput[],
): Promise<{ data: { id: string } | null; error: string | null }> {
  try {
    if (!operacionalCodigo.trim()) return { data: null, error: 'Técnico é obrigatório' }
    if (isNaN(Date.parse(dataSaida))) return { data: null, error: 'Data de saída inválida' }
    if (ordens.length === 0) return { data: null, error: 'Selecione ao menos uma ordem' }

    const { supabase, admin } = await getAuthenticatedAdminActionContext()
    const { data: saidaId, error } = await supabase.rpc('criar_saida_operacional', {
      p_operacional_codigo: operacionalCodigo,
      p_data_saida: dataSaida,
      p_admin_id: admin.id,
      p_ordens: ordens,
      p_observacao: observacao,
    })

    if (error) return { data: null, error: error.message }
    if (typeof saidaId !== 'string') {
      return { data: null, error: 'O banco não retornou a saída criada' }
    }

    revalidatePath('/admin/saidas', 'layout')
    return { data: { id: saidaId }, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function cancelarSaidaOperacional(
  saidaId: string,
): Promise<{ error: string | null }> {
  try {
    if (!saidaId.trim()) return { error: 'ID da saída é obrigatório' }

    const { supabase } = await getAuthenticatedAdminActionContext()

    const { error } = await supabase.rpc('cancelar_saida_operacional', {
      p_saida_id: saidaId,
    })

    if (error) return { error: error.message }

    revalidatePath('/admin/saidas', 'layout')
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function redistribuirOrdemOperacional(
  input: RedistribuirOrdemInput,
): Promise<RedistribuirOrdemResult> {
  let command: RedistribuicaoCommand | null = null

  try {
    const saidaOrdemId = input.saidaOrdemId.trim()
    const novoOperacionalCodigo = input.novoOperacionalCodigo.trim()
    const motivo = input.motivo.trim().replace(/\s+/g, ' ')

    if (!UUID_PATTERN.test(saidaOrdemId)) {
      return { data: null, error: 'Ordem da saída inválida' }
    }
    if (!novoOperacionalCodigo) {
      return { data: null, error: 'Novo operacional é obrigatório' }
    }
    if (motivo.length < 5 || motivo.length > 500) {
      return { data: null, error: 'O motivo deve ter entre 5 e 500 caracteres' }
    }

    const [{ supabase, admin }, performedByEmail] = await Promise.all([
      getAuthenticatedAdminActionContext(),
      getSessionEmail(),
    ])
    if (!performedByEmail) {
      return { data: null, error: 'Sessão expirada. Entre novamente para redistribuir a ordem' }
    }

    const { data: requested, error: requestError } = await supabase.rpc(
      'solicitar_redistribuicao_ordem',
      {
        p_saida_ordem_id: saidaOrdemId,
        p_novo_operacional_codigo: novoOperacionalCodigo,
        p_admin_id: admin.id,
        p_motivo: motivo,
        p_idempotency_key: crypto.randomUUID(),
      },
    )

    if (requestError) return { data: null, error: requestError.message }
    command = parseRedistribuicaoCommand(requested)

    if (command.status === 'completed') {
      revalidatePath('/admin/saidas', 'layout')
      revalidatePath('/operacional', 'layout')
      return {
        data: {
          commandId: command.command_id,
          targetSaidaId: command.target_cockpit_cargo_id,
        },
        error: null,
      }
    }

    const { data: started, error: startError } = await supabase.rpc(
      'iniciar_redistribuicao_ordem',
      {
        p_redistribuicao_id: command.command_id,
        p_admin_id: admin.id,
      },
    )
    if (startError) return { data: null, error: startError.message }
    command = parseRedistribuicaoCommand(started)

    const payload: ReassignRouteOrderPayload = {
      idempotency_key: command.idempotency_key,
      order_number: command.order_number,
      source_cockpit_cargo_id: command.source_cockpit_cargo_id,
      target_cockpit_cargo_id: command.target_cockpit_cargo_id,
      target_operational_id: command.target_rota_operational_id,
      planned_date: command.planned_date,
      reason: command.reason,
      performed_by_email: performedByEmail,
    }

    const response = await fetch(`${getRotaApiUrl()}/integration/reassign-order`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getRotaIntegrationSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    const responseBody = await response.json().catch(() => ({})) as Partial<ReassignRouteOrderResponse> & {
      error?: string
    }

    if (!response.ok) {
      throw new Error(responseBody.error || `ROTA indisponível (HTTP ${response.status})`)
    }
    if (
      responseBody.idempotency_key !== command.idempotency_key
      || typeof responseBody.reassignment_id !== 'string'
      || typeof responseBody.route_order_id !== 'string'
      || responseBody.order_number !== command.order_number
      || responseBody.target_operational_id !== command.target_rota_operational_id
      || typeof responseBody.source_route_id !== 'string'
      || typeof responseBody.target_route_id !== 'string'
      || typeof responseBody.source_stop_id !== 'string'
      || typeof responseBody.target_stop_id !== 'string'
      || typeof responseBody.source_operational_id !== 'string'
      || typeof responseBody.source_dispatch_id !== 'string'
      || typeof responseBody.target_dispatch_id !== 'string'
    ) {
      throw new Error('O ROTA retornou uma confirmação inválida')
    }

    const { data: confirmed, error: confirmError } = await supabase.rpc(
      'confirmar_redistribuicao_ordem',
      {
        p_redistribuicao_id: command.command_id,
        p_admin_id: admin.id,
        p_rota_transfer_id: responseBody.reassignment_id,
      },
    )
    if (confirmError) throw new Error(confirmError.message)

    command = parseRedistribuicaoCommand(confirmed)
    revalidatePath('/admin/saidas', 'layout')
    revalidatePath('/operacional', 'layout')

    return {
      data: {
        commandId: command.command_id,
        targetSaidaId: command.target_cockpit_cargo_id,
      },
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError'
      ? 'O ROTA demorou para responder. Tente novamente para reconciliar a redistribuição'
      : err instanceof Error
        ? err.message
        : 'Erro inesperado ao redistribuir a ordem'

    if (command) {
      try {
        const { supabase, admin } = await getAuthenticatedAdminActionContext()
        await supabase.rpc('registrar_falha_redistribuicao_ordem', {
          p_redistribuicao_id: command.command_id,
          p_admin_id: admin.id,
          p_erro: message.slice(0, 500),
        })
      } catch {
        // A transferência permanece reconciliável pela mesma chave idempotente.
      }
    }

    return { data: null, error: message }
  }
}

export async function registrarResultadoOrdem(
  saidaOrdemId: string,
  resultado: SaidaOrdemResultado,
  observacao: string | null,
): Promise<{ error: string | null }> {
  try {
    const supabase = createAdminClient()
    const email = await getSessionEmail()

    if (!email) return { error: 'Não autenticado' }

    const { data: adminData } = await supabase
      .from('vw_administrador_por_email')
      .select('id, role, operacional_codigo')
      .eq('email', email)
      .maybeSingle()

    if (!adminData) return { error: 'Usuário não encontrado' }

    if (adminData.role !== 'operacional') {
      return { error: 'Apenas técnicos operacionais podem registrar resultados' }
    }

    const opCodigo = (adminData as { operacional_codigo?: string | null }).operacional_codigo
    if (!opCodigo) return { error: 'Usuário não vinculado a operacional' }

    // Verifica que a saída pertence ao técnico logado
    const { data: ordemData } = await supabase
      .from('operacional_saida_ordens')
      .select('saida_id, operacional_saidas!inner(operacional_codigo)')
      .eq('id', saidaOrdemId)
      .maybeSingle()

    const saida = ordemData as { saida_id: string; operacional_saidas: { operacional_codigo: string } } | null
    if (!saida) return { error: 'Ordem não encontrada' }
    if (saida.operacional_saidas.operacional_codigo !== opCodigo) {
      return { error: 'Acesso negado: saída não pertence a este técnico' }
    }

    const { error } = await supabase.rpc('registrar_resultado_ordem', {
      p_saida_ordem_id: saidaOrdemId,
      p_resultado: resultado,
      p_observacao: observacao,
    })

    if (error) return { error: error.message }

    revalidatePath(`/operacional/saida/${saida.saida_id}`)
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function publicarSaidaNoRota(saidaId: string): Promise<PublishRotaResult> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saidaId)) {
      return { data: null, error: 'ID da saída inválido' }
    }

    const { supabase } = await getAuthenticatedAdminActionContext()

    const { data: existing, error: existingError } = await supabase
      .schema('integration')
      .from('route_dispatches')
      .select('id, status, published_at')
      .eq('cockpit_cargo_id', saidaId)
      .maybeSingle()

    if (existingError) return { data: null, error: existingError.message }
    if (existing) {
      return {
        data: {
          id: existing.id as string,
          status: existing.status as RotaDispatchStatus,
          publishedAt: existing.published_at as string,
        },
        error: null,
      }
    }

    const { data: saida, error: saidaError } = await supabase
      .from('operacional_saidas')
      .select(`
        id, operacional_codigo, status, data_saida,
        operacional_saida_ordens (ordem_codigo, unidade, created_at)
      `)
      .eq('id', saidaId)
      .maybeSingle()

    if (saidaError) return { data: null, error: saidaError.message }
    if (!saida) return { data: null, error: 'Saída não encontrada' }
    if (saida.status !== 'em_rota') {
      return { data: null, error: 'Somente saídas em rota podem ser publicadas' }
    }

    const { data: operational, error: operationalError } = await supabase
      .from('administradores')
      .select('auth_user_id')
      .eq('operacional_codigo', saida.operacional_codigo)
      .eq('role', 'operacional')
      .eq('ativo', true)
      .limit(1)
      .maybeSingle()

    if (operationalError) return { data: null, error: operationalError.message }
    if (!operational?.auth_user_id) {
      return {
        data: null,
        error: 'O técnico desta saída ainda não possui acesso vinculado ao ROTA',
      }
    }

    const publishedByEmail = await getSessionEmail()
    if (!publishedByEmail) {
      return { data: null, error: 'Sessão expirada. Entre novamente para publicar no ROTA' }
    }

    const rawOrders = (saida.operacional_saida_ordens ?? []) as Array<{
      ordem_codigo: string
      unidade: string | null
      created_at: string
    }>
    const payload = buildPublishRoutePayload(
      {
        id: saida.id,
        dataSaida: saida.data_saida,
        ordens: rawOrders.map((order) => ({
          ordemCodigo: order.ordem_codigo,
          unidade: order.unidade,
          createdAt: order.created_at,
        })),
      },
      operational.auth_user_id,
      publishedByEmail,
    )

    const response = await fetch(`${getRotaApiUrl()}/integration/publish-route`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getRotaIntegrationSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    const responseBody = await response.json().catch(() => ({})) as {
      dispatch_id?: string
      error?: string
    }

    if (!response.ok) {
      return {
        data: null,
        error: responseBody.error || `ROTA indisponível (HTTP ${response.status})`,
      }
    }

    revalidatePath(`/admin/saidas/${saidaId}`)
    revalidatePath('/admin/saidas')

    return {
      data: {
        id: responseBody.dispatch_id ?? saidaId,
        status: 'published',
        publishedAt: new Date().toISOString(),
      },
      error: null,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { data: null, error: 'O ROTA demorou para responder. Tente novamente' }
    }
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
