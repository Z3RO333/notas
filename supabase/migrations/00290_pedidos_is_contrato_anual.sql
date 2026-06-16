-- 00290_pedidos_is_contrato_anual.sql
-- Adiciona flag is_contrato_anual a pedidos_compra para identificar contratos
-- de manutenção preventiva anual/mensal/trimestral/semestral.
-- Somente esses pedidos aparecem na coluna "Nº Pedido" da carteira preventiva.

ALTER TABLE public.pedidos_compra
  ADD COLUMN IF NOT EXISTS is_contrato_anual BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_is_contrato_anual
  ON public.pedidos_compra (is_contrato_anual)
  WHERE is_contrato_anual = true;

-- Backfill: contratos preventivos identificados manualmente
UPDATE public.pedidos_compra
SET is_contrato_anual = true
WHERE documento_compras IN (
  -- Elevadores / Plataformas / Monta Carga
  '4508551006','4508545460','4508540137','4508539789','4508539831',
  '4508554010','4508565238','4508554000','4508561865','4508557349',
  -- ETE / Caixa d'agua / Gerador / Dedetização / Paisagismo / Limpeza
  '4508546120','4508562029','4508548699','4508547151','4508548366',
  '4508548452','4508537868','4508548763','4508564720','4508564243',
  '4508562755','4508525270','4508525557','4508546423',
  -- Análise bacteriológica / Ambiental
  '4508546803','4508591118','4508607259','4508551000','4508553643',
  '4508551149','4508595428','4508558164',
  -- Refrigeração
  '4508539437','4508539797','4508539985','4508539572','4508540048',
  '4508540095','4508540138','4508540165','4508540202','4508540214',
  '4508540220','4508621364',
  -- Gerador
  '4508550869','4508557761','4508560364','4508590825',
  -- Bomba / Outros
  '4508546761','4508557436','4508557420','4508554021',
  -- Gás / Panificadora / Material
  '4508672134','4508681295','4508812104','4508696343','4508725078'
);

-- Atualiza view para usar o flag
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
  ) AS documentos_compras
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.pedidos_compra p
  ON normalize_supplier_code(p.fornecedor::text) = c.fornecedor_codigo
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY COALESCE(SUM(p.valor_liquido_total), 0) DESC NULLS LAST;
