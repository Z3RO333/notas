'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedAdminActionContext } from '@/lib/actions/admin-action-support'
import type { CriarSaidaOrdemInput, SaidaOrdemResultado } from '@/lib/types/saidas'

export async function criarSaidaOperacional(
  operacionalCodigo: string,
  dataSaida: string,
  observacao: string | null,
  ordens: CriarSaidaOrdemInput[],
): Promise<{ data: { id: string } | null; error: string | null }> {
  try {
    if (!operacionalCodigo.trim()) return { data: null, error: 'Técnico é obrigatório' }
    if (isNaN(Date.parse(dataSaida))) return { data: null, error: 'Data de saída inválida' }

    const { supabase, admin } = await getAuthenticatedAdminActionContext()

    const { data, error } = await supabase.rpc('criar_saida_operacional', {
      p_operacional_codigo: operacionalCodigo,
      p_data_saida: dataSaida,
      p_admin_id: admin.id,
      p_ordens: ordens,
      p_observacao: observacao,
    })

    if (error) return { data: null, error: error.message }

    revalidatePath('/admin/saidas', 'layout')
    return { data: { id: data as string }, error: null }
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
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user?.email) return { error: 'Não autenticado' }

    const { data: adminData } = await supabase
      .from('administradores')
      .select('id, role, operacional_codigo')
      .eq('email', user.email)
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
