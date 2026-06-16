'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import type { CriarSaidaOrdemInput, SaidaOrdemResultado } from '@/lib/types/saidas'

async function assertAdminOuGestor() {
  const ctx = await getCurrentAdminContext()
  if (!ctx.isAuthenticated || !ctx.adminId) throw new Error('Não autenticado')
  if (ctx.role !== 'admin' && ctx.role !== 'gestor') throw new Error('Acesso restrito a admins e gestores')
  return ctx
}

export async function criarSaidaOperacional(
  operacionalCodigo: string,
  dataSaida: string,
  observacao: string | null,
  ordens: CriarSaidaOrdemInput[],
): Promise<{ data: { id: string } | null; error: string | null }> {
  try {
    const ctx = await assertAdminOuGestor()
    const supabase = await createClient()

    const { data, error } = await supabase.rpc('criar_saida_operacional', {
      p_operacional_codigo: operacionalCodigo,
      p_data_saida: dataSaida,
      p_admin_id: ctx.adminId!,
      p_ordens: ordens,
      p_observacao: observacao,
    })

    if (error) return { data: null, error: error.message }

    revalidatePath('/admin/saidas')
    return { data: { id: data as string }, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function cancelarSaidaOperacional(
  saidaId: string,
): Promise<{ error: string | null }> {
  try {
    await assertAdminOuGestor()
    const supabase = await createClient()

    const { error } = await supabase.rpc('cancelar_saida_operacional', {
      p_saida_id: saidaId,
    })

    if (error) return { error: error.message }

    revalidatePath('/admin/saidas')
    revalidatePath(`/admin/saidas/${saidaId}`)
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
    const ctx = await getCurrentAdminContext()
    if (!ctx.isAuthenticated || !ctx.adminId) return { error: 'Não autenticado' }

    const supabase = await createClient()

    // Verifica que a saída pertence ao técnico logado
    const { data: adminData } = await supabase
      .from('administradores')
      .select('operacional_codigo')
      .eq('id', ctx.adminId)
      .maybeSingle()
    const operacionalCodigo = (adminData as { operacional_codigo?: string | null } | null)?.operacional_codigo

    if (!operacionalCodigo) return { error: 'Usuário não vinculado a operacional' }

    const { data: ordemData } = await supabase
      .from('operacional_saida_ordens')
      .select('saida_id, operacional_saidas!inner(operacional_codigo)')
      .eq('id', saidaOrdemId)
      .maybeSingle()

    const saida = ordemData as { saida_id: string; operacional_saidas: { operacional_codigo: string } } | null
    if (!saida) return { error: 'Ordem não encontrada' }
    if (saida.operacional_saidas.operacional_codigo !== operacionalCodigo) {
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
