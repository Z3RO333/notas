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
