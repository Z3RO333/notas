import type { SupabaseClient } from '@supabase/supabase-js'

export interface PmplCarteiraRow {
  fornecedorCodigo: string
  fornecedorNome: string | null
  adminId: string
  adminNome: string | null
  adminAvatar: string | null
  qtdAbertas: number
  qtdAtrasadas: number
}

export interface PmplFornecedorSemDono {
  fornecedorCodigo: string
  fornecedorNome: string | null
  qtdAbertas: number
}

export async function listarCarteiraPmpl(supabase: SupabaseClient): Promise<PmplCarteiraRow[]> {
  const { data, error } = await supabase
    .from('vw_pmpl_carteira_resumo')
    .select('fornecedor_codigo, fornecedor_nome, admin_id, admin_nome, admin_avatar, qtd_abertas, qtd_atrasadas')

  if (error) throw error

  return (data ?? []).map((row) => ({
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_nome ?? null,
    adminId: row.admin_id,
    adminNome: row.admin_nome ?? null,
    adminAvatar: row.admin_avatar ?? null,
    qtdAbertas: row.qtd_abertas ?? 0,
    qtdAtrasadas: row.qtd_atrasadas ?? 0,
  }))
}

export async function listarFornecedoresSemDono(supabase: SupabaseClient): Promise<PmplFornecedorSemDono[]> {
  const { data, error } = await supabase
    .from('vw_pmpl_fornecedores_sem_dono')
    .select('fornecedor_codigo, fornecedor_nome, qtd_abertas')

  if (error) throw error

  return (data ?? []).map((row) => ({
    fornecedorCodigo: row.fornecedor_codigo,
    fornecedorNome: row.fornecedor_nome ?? null,
    qtdAbertas: row.qtd_abertas ?? 0,
  }))
}
