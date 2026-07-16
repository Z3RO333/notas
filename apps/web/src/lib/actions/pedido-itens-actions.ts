'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionEmail } from '@/lib/auth/session'
import type { PedidoCompraItem } from '@/lib/types/pedidos'

export async function buscarItensPedido(documentoCompras: string): Promise<PedidoCompraItem[]> {
  const email = await getSessionEmail()
  if (!email) throw new Error('Nao autenticado')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pedidos_compra_itens')
    .select('*')
    .eq('documento_compras', documentoCompras)
    .order('item_numero')

  if (error) throw error
  return (data ?? []) as PedidoCompraItem[]
}
