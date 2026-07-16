'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'

export interface OperacionalEmCampo {
  fornecedor_codigo: string
  fornecedor_nome: string
  total_em_campo: number
  ordens: string[]
  unidades: string[]
}

export async function buscarOperacionaisEmCampo(): Promise<OperacionalEmCampo[]> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('buscar_operacionais_em_campo')
  if (error) throw error
  return (data as OperacionalEmCampo[]) ?? []
}
