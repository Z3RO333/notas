'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'

export interface OperacionalCargaRow {
  fornecedor_codigo: string
  fornecedor_nome: string
  total_em_campo: number
  ordens_mesma_loja_ativas: number
}

export interface ServicoHistoricoRow {
  texto_breve: string
  total_ordens: number
}

export interface OperacionalSuggestionRow extends OperacionalCargaRow {
  historico_loja_servico: number
  historico_servico_geral: number
  match_mode: string | null
}

async function requireSession(): Promise<void> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')
}

export async function listarServicosHistoricosNotasEmCampo(): Promise<ServicoHistoricoRow[]> {
  await requireSession()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('listar_servicos_historicos_notas_em_campo', { p_limit: 250 })
  if (error) throw error
  return (data ?? []) as ServicoHistoricoRow[]
}

export async function listarOperacionaisCargaNotasEmCampo(
  nomeLoja: string | null,
): Promise<OperacionalCargaRow[]> {
  await requireSession()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('listar_operacionais_carga_notas_em_campo', {
    p_nome_loja: nomeLoja,
  })
  if (error) throw error
  return (data ?? []) as OperacionalCargaRow[]
}

export async function buscarSugestoesOperacionaisNotasEmCampo(
  nomeLoja: string,
  textoBreve: string,
): Promise<OperacionalSuggestionRow[]> {
  await requireSession()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('buscar_sugestoes_operacionais_notas_em_campo', {
    p_nome_loja: nomeLoja,
    p_texto_breve: textoBreve,
  })
  if (error) throw error
  return (data ?? []) as OperacionalSuggestionRow[]
}
