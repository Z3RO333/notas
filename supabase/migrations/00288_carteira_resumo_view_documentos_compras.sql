-- 00288_carteira_resumo_view_documentos_compras.sql
--
-- Adiciona documentos_compras (array) à vw_pedidos_carteira_fornecedor_resumo
-- para que o frontend não precise de mapa hardcoded de pedidos por fornecedor.
-- Os números de pedido passam a vir dinamicamente do banco via API.

CREATE OR REPLACE VIEW public.vw_pedidos_carteira_fornecedor_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id   AS admin_id,
  a.nome AS admin_nome,
  a.avatar_url AS admin_avatar,
  COUNT(p.id)::integer AS qtd_pedidos,
  COUNT(p.id) FILTER (WHERE p.status = 'em_aberto')::integer   AS em_aberto,
  COUNT(p.id) FILTER (WHERE p.status = 'encerrado')::integer   AS encerrado,
  COUNT(p.id) FILTER (WHERE p.status = 'cancelado')::integer   AS cancelado,
  COALESCE(SUM(p.valor_liquido_total), 0) AS valor_total,
  c.tipo_carteira,
  ARRAY_REMOVE(
    ARRAY_AGG(p.documento_compras ORDER BY p.documento_compras),
    NULL
  ) AS documentos_compras
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.pedidos_compra p
  ON normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY COALESCE(SUM(p.valor_liquido_total), 0) DESC NULLS LAST;
