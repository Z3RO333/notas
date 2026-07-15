'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'

export interface PmplCarteiraPreview {
  fornecedorCodigo: string
  fornecedorNome: string | null
  adminAtualId: string | null
  adminAtualNome: string | null
  adminNovoId: string
  adminNovoNome: string | null
  qtdOrdendsAbertas: number
  qtdOrdensIgnoradas: number
}

export interface PmplCarteiraResumo {
  fornecedorCodigo: string
  fornecedorNome: string | null
  adminAnteriorId: string | null
  adminAnteriorNome: string | null
  adminNovoId: string
  adminNovoNome: string | null
  qtdOrdendsAbertasAfetadas: number
}

export async function previewRealocarCarteiraPmpl(
  fornecedorCodigo: string,
  novoAdminId: string,
): Promise<{ data: PmplCarteiraPreview | null; error: string | null }> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('preview_realocar_carteira_pmpl', {
      p_fornecedor_codigo: fornecedorCodigo,
      p_novo_admin_id: novoAdminId,
    })

    if (error) return { data: null, error: error.message }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { data: null, error: 'Fornecedor não encontrado na carteira' }

    return {
      data: {
        fornecedorCodigo: row.fornecedor_codigo,
        fornecedorNome: row.fornecedor_nome ?? null,
        adminAtualId: row.admin_atual_id ?? null,
        adminAtualNome: row.admin_atual_nome ?? null,
        adminNovoId: row.admin_novo_id,
        adminNovoNome: row.admin_novo_nome ?? null,
        qtdOrdendsAbertas: row.qtd_ordens_abertas ?? 0,
        qtdOrdensIgnoradas: row.qtd_ordens_ignoradas ?? 0,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function realocarCarteiraPmplFornecedor(
  fornecedorCodigo: string,
  novoAdminId: string,
  motivo?: string,
): Promise<{ data: PmplCarteiraResumo | null; error: string | null }> {
  try {
    const ctx = await getCurrentAdminContext()

    if (!ctx.isGestor || !ctx.adminId) {
      return { data: null, error: 'Apenas gestores podem realocar carteiras PMPL.' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('realocar_carteira_pmpl_fornecedor', {
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
        qtdOrdendsAbertasAfetadas: row.qtd_ordens_abertas_afetadas ?? 0,
      },
      error: null,
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
