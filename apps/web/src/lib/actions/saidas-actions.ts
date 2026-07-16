'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'
import { getAuthenticatedAdminActionContext } from '@/lib/actions/admin-action-support'
import { buildPublishRoutePayload } from '@/lib/saidas/rota-integration'
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

    const { data: operacional, error: operacionalError } = await supabase
      .from('dim_operacionais')
      .select('nome')
      .eq('codigo', operacionalCodigo)
      .eq('ativo', true)
      .maybeSingle()

    if (operacionalError) return { data: null, error: operacionalError.message }
    if (!operacional?.nome) return { data: null, error: `Operacional não encontrado: ${operacionalCodigo}` }

    const { data: saida, error: saidaError } = await supabase
      .from('operacional_saidas')
      .insert({
        operacional_codigo: operacionalCodigo,
        operacional_nome_snapshot: operacional.nome,
        criado_por_admin_id: admin.id,
        data_saida: dataSaida,
        observacao,
      })
      .select('id')
      .single()

    if (saidaError) return { data: null, error: saidaError.message }

    const { error: ordensError } = await supabase
      .from('operacional_saida_ordens')
      .insert(ordens.map((ordem) => ({
        saida_id: saida.id,
        ordem_codigo: ordem.ordem_codigo,
        numero_nota: ordem.numero_nota,
        unidade: ordem.unidade,
        texto_breve: ordem.texto_breve,
        status_ordem_raw_snapshot: ordem.status_ordem_raw_snapshot,
        tipo_ordem: ordem.tipo_ordem,
      })))

    if (ordensError) {
      await supabase.from('operacional_saidas').delete().eq('id', saida.id)
      return { data: null, error: ordensError.message }
    }

    revalidatePath('/admin/saidas', 'layout')
    return { data: { id: saida.id as string }, error: null }
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
      .from('administradores')
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
