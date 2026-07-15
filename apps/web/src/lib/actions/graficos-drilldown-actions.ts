'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'

export interface OrdemDrilldownRow {
  id: string
  ordem_codigo: string | null
  status_ordem_raw: string | null
  data_entrada: string | null
  tipo_ordem: string | null
  criado_por?: string | null
  notas_manutencao?: { descricao: string | null; centro: string | null } | null
  descricao?: string | null
  centro?: string | null
}

export interface BuscarOrdensDrilldownParams {
  nomeLoja: string
  ano?: number
  mes?: number
  tipoOrdem?: string
  equipamento?: string
  categoria?: string
}

export async function buscarOrdensDrilldown(
  params: BuscarOrdensDrilldownParams,
): Promise<OrdemDrilldownRow[]> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')

  const supabase = createAdminClient()
  const { nomeLoja, ano, mes, tipoOrdem, equipamento, categoria } = params

  if (categoria) {
    const { data } = await supabase
      .rpc('buscar_ordens_equipamento', {
        p_nome_loja: nomeLoja,
        p_categoria: categoria,
        p_ano: ano ?? null,
        p_mes: mes ?? null,
        p_tipo_ordem: tipoOrdem ?? null,
        p_equipamento: equipamento ?? null,
      })
    return (data as unknown as OrdemDrilldownRow[]) ?? []
  }

  let q = supabase
    .from('ordens_notas_acompanhamento')
    .select('id, ordem_codigo, status_ordem_raw, data_entrada, tipo_ordem, criado_por, notas_manutencao!nota_id(descricao, centro)')
    .eq('denominacao_unidade', nomeLoja)
    .order('data_entrada', { ascending: false })
    .limit(200)

  if (tipoOrdem) q = q.eq('tipo_ordem', tipoOrdem)
  if (mes && ano) {
    const pad = String(mes).padStart(2, '0')
    const lastDay = new Date(ano, mes, 0).getDate()
    q = q.filter('data_entrada', 'gte', `${ano}-${pad}-01`)
         .filter('data_entrada', 'lte', `${ano}-${pad}-${lastDay}`)
  } else if (ano) {
    q = q.filter('data_entrada', 'gte', `${ano}-01-01`)
         .filter('data_entrada', 'lte', `${ano}-12-31`)
  }

  const { data } = await q
  return (data as unknown as OrdemDrilldownRow[]) ?? []
}
