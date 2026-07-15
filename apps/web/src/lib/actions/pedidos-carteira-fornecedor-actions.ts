'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'

export interface PedidosCarteiraRealocacaoResumo {
  fornecedorCodigo: string
  fornecedorNome: string | null
  adminAnteriorId: string | null
  adminAnteriorNome: string | null
  adminNovoId: string
  adminNovoNome: string | null
}

export async function realocarCarteiraFornecedorPedidos(
  fornecedorCodigo: string,
  novoAdminId: string,
  motivo?: string,
): Promise<{ data: PedidosCarteiraRealocacaoResumo | null; error: string | null }> {
  try {
    const ctx = await getCurrentAdminContext()

    if (!ctx.isGestor || !ctx.adminId) {
      return { data: null, error: 'Apenas gestores podem realocar a carteira de fornecedores de Pedidos de Compra.' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('realocar_carteira_fornecedor_pedidos', {
      p_fornecedor_codigo: fornecedorCodigo,
      p_novo_admin_id: novoAdminId,
      p_gestor_id: ctx.adminId,
      p_motivo: motivo ?? null,
    })

    if (error) return { data: null, error: error.message }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { data: null, error: 'Nenhum resultado retornado' }

    return {
      data: {
        fornecedorCodigo: row.fornecedor_codigo,
        fornecedorNome: row.fornecedor_nome ?? null,
        adminAnteriorId: row.admin_anterior_id ?? null,
        adminAnteriorNome: row.admin_anterior_nome ?? null,
        adminNovoId: row.admin_novo_id,
        adminNovoNome: row.admin_novo_nome ?? null,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
