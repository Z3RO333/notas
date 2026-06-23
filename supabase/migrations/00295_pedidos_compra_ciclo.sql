-- 00295_pedidos_compra_ciclo.sql
-- Adiciona coluna ciclo a pedidos_compra para identificar a periodicidade
-- do contrato preventivo (MENSAL, TRIMESTRAL, SEMESTRAL, SEMANAL, ANUAL).
-- Atualiza a view de resumo para incluir pedidos_contratos como JSONB array
-- com numero, ciclo e admin de cada pedido contrato anual.

-- 1) Coluna ciclo
ALTER TABLE public.pedidos_compra
  ADD COLUMN IF NOT EXISTS ciclo TEXT;

-- 2) Backfill ciclo dos contratos preventivos
UPDATE public.pedidos_compra SET ciclo = v.ciclo
FROM (VALUES
  ('4508551006', 'TRIMESTRAL'),
  ('4508545460', 'TRIMESTRAL'),
  ('4508553643', 'TRIMESTRAL'),
  ('4508540137', 'MENSAL'),
  ('4508539789', 'MENSAL'),
  ('4508539831', 'MENSAL'),
  ('4508546120', 'MENSAL'),
  ('4508562029', 'MENSAL'),
  ('4508548699', 'MENSAL'),
  ('4508547151', 'MENSAL'),
  ('4508548366', 'MENSAL'),
  ('4508548452', 'MENSAL'),
  ('4508537868', 'MENSAL'),
  ('4508548763', 'MENSAL'),
  ('4508564720', 'MENSAL'),
  ('4508562755', 'MENSAL'),
  ('4508525270', 'MENSAL'),
  ('4508525557', 'MENSAL'),
  ('4508539437', 'MENSAL'),
  ('4508539797', 'MENSAL'),
  ('4508539985', 'MENSAL'),
  ('4508539572', 'MENSAL'),
  ('4508540048', 'MENSAL'),
  ('4508540095', 'MENSAL'),
  ('4508540138', 'MENSAL'),
  ('4508540165', 'MENSAL'),
  ('4508540202', 'MENSAL'),
  ('4508540214', 'MENSAL'),
  ('4508540220', 'MENSAL'),
  ('4508621364', 'MENSAL'),
  ('4508558164', 'MENSAL'),
  ('4508672134', 'MENSAL'),
  ('4508812104', 'MENSAL'),
  ('4508696343', 'MENSAL'),
  ('4508725078', 'MENSAL'),
  ('4508550869', 'MENSAL'),
  ('4508557761', 'MENSAL'),
  ('4508560364', 'MENSAL'),
  ('4508546761', 'MENSAL'),
  ('4508557436', 'MENSAL'),
  ('4508557420', 'MENSAL'),
  ('4508554021', 'MENSAL'),
  ('4508554010', 'MENSAL'),
  ('4508565238', 'MENSAL'),
  ('4508557349', 'MENSAL'),
  ('4508554000', 'MENSAL'),
  ('4508561865', 'MENSAL'),
  ('4508546803', 'SEMESTRAL'),
  ('4508591118', 'SEMESTRAL'),
  ('4508607259', 'SEMESTRAL'),
  ('4508546423', 'SEMESTRAL'),
  ('4508551000', 'SEMESTRAL'),
  ('4508551149', 'SEMESTRAL'),
  ('4508681295', 'SEMANAL')
) AS v(doc, ciclo)
WHERE public.pedidos_compra.documento_compras = v.doc;

-- 3) Atualiza view com pedidos_contratos JSONB array (inclui ciclo + admin por pedido)
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
    ARRAY_AGG(
      p.documento_compras ORDER BY p.documento_compras
    ) FILTER (WHERE p.is_contrato_anual = true),
    NULL
  ) AS documentos_compras,
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
LEFT JOIN public.pedidos_compra p
  ON public.normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
LEFT JOIN public.administradores pa ON pa.id = p.administrador_id
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY COALESCE(SUM(p.valor_liquido_total), 0) DESC NULLS LAST;
