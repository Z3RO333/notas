-- 00304_fix_carteira_resumo_admin_por_pedido.sql
--
-- Bug: vw_pedidos_carteira_fornecedor_resumo preenchia admin_id/admin_nome/
-- admin_avatar de CADA pedido dentro de pedidos_contratos com o DONO DA
-- CARTEIRA do fornecedor (c.administrador_id), não com o administrador_id
-- individual de cada pedido. O frontend (fornecedores-carteira-panel.tsx)
-- já tentava exibir o admin por pedido (`pedido.admin_nome`), mas a view
-- sempre devolvia o mesmo dono pra todos os pedidos do fornecedor.
--
-- Sintoma relatado: fornecedor com pedidos de categorias diferentes
-- atribuídos a admins diferentes (ex: FERREIRA E FERREIRA, cod. 11371 —
-- refrigeração com Suelém, gerador com Fabíola) aparecia com os dois
-- pedidos sob o mesmo nome na tela de carteira/preventivas.
--
-- Fix: LEFT JOIN adicional em administradores pelo administrador_id de
-- CADA pedido (pa), usado dentro do jsonb_build_object de pedidos_contratos.
-- O admin/nome/avatar de topo da linha (a.*) continua sendo o dono da
-- carteira do fornecedor (usado como fallback e no card agregado).
-- Nenhuma coluna trocou de nome/tipo — mudança de dado, não de contrato.

CREATE OR REPLACE VIEW public.vw_pedidos_carteira_fornecedor_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id AS admin_id,
  a.nome AS admin_nome,
  a.avatar_url AS admin_avatar,
  count(p.id)::integer AS qtd_pedidos,
  count(p.id) FILTER (WHERE p.status = 'em_aberto'::pedido_compra_status)::integer AS em_aberto,
  count(p.id) FILTER (WHERE p.status = 'encerrado'::pedido_compra_status)::integer AS encerrado,
  count(p.id) FILTER (WHERE p.status = 'cancelado'::pedido_compra_status)::integer AS cancelado,
  COALESCE(sum(p.valor_liquido_total), 0::numeric) AS valor_total,
  c.tipo_carteira,
  array_remove(array_agg(p.documento_compras ORDER BY p.documento_compras) FILTER (WHERE p.is_contrato_anual = true), NULL::character varying) AS documentos_compras,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'numero', p.documento_compras,
        'ciclo', p.ciclo,
        'admin_id', pa.id,
        'admin_nome', pa.nome,
        'admin_avatar', pa.avatar_url
      ) ORDER BY p.documento_compras
    ) FILTER (WHERE p.is_contrato_anual = true AND p.documento_compras IS NOT NULL),
    '[]'::jsonb
  ) AS pedidos_contratos
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.pedidos_compra p ON public.normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
LEFT JOIN public.administradores pa ON pa.id = p.administrador_id
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY (COALESCE(sum(p.valor_liquido_total), 0::numeric)) DESC NULLS LAST;

-- Reativa a carteira do fornecedor 11371 (Ferreira e Ferreira) — desativada
-- na sessão anterior por precaução antes deste fix; agora que a view exibe
-- o admin correto por pedido, pode voltar a aparecer na tela.
UPDATE public.pedidos_compra_carteira_fornecedor
SET ativo = true, updated_at = now()
WHERE fornecedor_codigo = '11371';
