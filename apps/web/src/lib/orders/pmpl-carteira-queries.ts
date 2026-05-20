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
  const { data: mapeados, error: erroMapeados } = await supabase
    .from('pmpl_carteira_fornecedor')
    .select('fornecedor_codigo')
    .eq('ativo', true)

  if (erroMapeados) throw erroMapeados

  const codigosMapeados = (mapeados ?? []).map((r) => r.fornecedor_codigo)

  const { data, error } = await supabase
    .from('ordens_notas_acompanhamento')
    .select('fornecedor_codigo, fornecedor_nome')
    .eq('tipo_ordem', 'PMPL')
    .not('fornecedor_codigo', 'is', null)
    .not('status_ordem_raw', 'in', '("CONCLUIDO","CANCELADO","FINALIZADO","REJEITADA")')

  if (error) throw error

  const contagem = new Map<string, { nome: string | null; qtd: number }>()

  for (const row of data ?? []) {
    const codigo = (row.fornecedor_codigo ?? '').trim().toUpperCase()
    if (!codigo || codigosMapeados.includes(codigo)) continue

    const entry = contagem.get(codigo) ?? { nome: row.fornecedor_nome ?? null, qtd: 0 }
    entry.qtd += 1
    contagem.set(codigo, entry)
  }

  return Array.from(contagem.entries())
    .map(([codigo, entry]) => ({
      fornecedorCodigo: codigo,
      fornecedorNome: entry.nome,
      qtdAbertas: entry.qtd,
    }))
    .sort((a, b) => b.qtdAbertas - a.qtdAbertas)
}
