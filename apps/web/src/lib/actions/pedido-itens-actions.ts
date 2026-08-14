'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentAdminContext } from '@/lib/auth/current-admin-context'
import type { PedidoCompraItem } from '@/lib/types/pedidos'

export async function buscarItensPedido(documentoCompras: string): Promise<PedidoCompraItem[]> {
  const documento = documentoCompras.trim()
  if (!documento || documento.length > 20) throw new Error('Pedido invalido')

  const currentAdminContext = await getCurrentAdminContext()
  if (!currentAdminContext.isAuthenticated) throw new Error('Nao autenticado')
  if (
    !currentAdminContext.adminId
    || !currentAdminContext.role
    || !['admin', 'gestor', 'viewer'].includes(currentAdminContext.role)
  ) {
    throw new Error('Administrador nao encontrado')
  }

  const supabase = createAdminClient()
  const { data: pedido, error: pedidoError } = await supabase
    .from('vw_pedidos_compra_112')
    .select('administrador_id')
    .eq('documento_compras', documento)
    .maybeSingle()

  if (pedidoError) throw pedidoError
  if (!pedido) throw new Error('Pedido nao encontrado')
  if (!currentAdminContext.canViewGlobal && pedido.administrador_id !== currentAdminContext.adminId) {
    throw new Error('Sem permissao para visualizar este pedido')
  }

  const { data, error } = await supabase
    .from('pedidos_compra_itens')
    .select(
      'id, documento_compras, item_numero, descricao, codigo_material, grupo_mercadoria, quantidade, unidade_medida, preco_unitario, valor_liquido, centro, requisicao_compra, excluido'
    )
    .eq('documento_compras', documento)
    .eq('source_active', true)
    .order('item_numero')

  if (error) throw error
  return (data ?? []) as PedidoCompraItem[]
}
