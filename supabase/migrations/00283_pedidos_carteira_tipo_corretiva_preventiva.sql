-- 00283_pedidos_carteira_tipo_corretiva_preventiva.sql
--
-- Torna explícita a distinção entre fornecedores "corretiva" (pedido único
-- multiunidade, 00274) e "preventiva anual" (pedidos anuais 2026, 00281) na
-- carteira de fornecedores de Pedidos de Compra. Adiciona Casa Universal (827)
-- e Maqfuso (1258) à carteira corretiva.

-- ============================================================
-- 1) Coluna tipo_carteira com default temporário 'corretiva'
-- ============================================================
ALTER TABLE public.pedidos_compra_carteira_fornecedor
  ADD COLUMN IF NOT EXISTS tipo_carteira TEXT NOT NULL DEFAULT 'corretiva'
    CHECK (tipo_carteira IN ('corretiva', 'preventiva_anual'));

COMMENT ON COLUMN public.pedidos_compra_carteira_fornecedor.tipo_carteira IS
  'corretiva = fornecedores de pedido único multiunidade (00274); preventiva_anual = fornecedores dos pedidos anuais (00281). Determina em qual subaba de Pedidos de Compra o fornecedor aparece.';

-- ============================================================
-- 2) Backfill: fornecedores da seed 00281 -> preventiva_anual
--    (os da seed 00274 já ficam 'corretiva' pelo DEFAULT acima)
-- ============================================================
UPDATE public.pedidos_compra_carteira_fornecedor
SET tipo_carteira = 'preventiva_anual'
WHERE fornecedor_codigo IN (
  '41','15327','500','9331','17162','9214','12034','10745',
  '16904','672','15594','13851','17017','1188','14604',
  '13400','16513','15202','16119','12697','11371','6405',
  '8059','10364','16744','7949',
  '101',
  '9542','17753','12171','10070','10295','15738','14897','12029','13379','15363','18053'
);

-- Remove o default: toda inserção futura deve declarar tipo_carteira explicitamente
ALTER TABLE public.pedidos_compra_carteira_fornecedor
  ALTER COLUMN tipo_carteira DROP DEFAULT;

-- ============================================================
-- 3) Novos fornecedores corretiva: Casa Universal (827) -> Paula,
--    Maqfuso (1258) -> Rosana
-- ============================================================
DO $$
DECLARE
  v_paula  UUID;
  v_rosana UUID;
  v_walter UUID;
BEGIN
  SELECT id INTO v_paula  FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_rosana FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_walter FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';

  IF v_paula  IS NULL THEN RAISE EXCEPTION 'Admin Paula não encontrada';   END IF;
  IF v_rosana IS NULL THEN RAISE EXCEPTION 'Admin Rosana não encontrada';  END IF;
  IF v_walter IS NULL THEN RAISE EXCEPTION 'Admin Walter (autor do seed) não encontrado'; END IF;

  INSERT INTO public.pedidos_compra_carteira_fornecedor
    (fornecedor_codigo, fornecedor_nome, administrador_id, tipo_carteira, created_by, updated_by)
  VALUES
    ('827',  'CASA UNIVERSAL', v_paula,  'corretiva', v_walter, v_walter),
    ('1258', 'MAQFUSO',        v_rosana, 'corretiva', v_walter, v_walter)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        fornecedor_nome  = EXCLUDED.fornecedor_nome,
        tipo_carteira    = EXCLUDED.tipo_carteira,
        updated_at       = now(),
        updated_by       = EXCLUDED.updated_by;

  RAISE NOTICE 'Seed: Casa Universal (827) e Maqfuso (1258) adicionados à carteira corretiva.';
END;
$$;

-- ============================================================
-- 4) View de resumo: adiciona tipo_carteira
-- ============================================================
CREATE OR REPLACE VIEW public.vw_pedidos_carteira_fornecedor_resumo AS
SELECT
  c.fornecedor_codigo,
  c.fornecedor_nome,
  a.id         AS admin_id,
  a.nome       AS admin_nome,
  a.avatar_url AS admin_avatar,
  COUNT(p.id)::INTEGER AS qtd_pedidos,
  COUNT(p.id) FILTER (WHERE p.status = 'em_aberto')::INTEGER AS em_aberto,
  COUNT(p.id) FILTER (WHERE p.status = 'encerrado')::INTEGER AS encerrado,
  COUNT(p.id) FILTER (WHERE p.status = 'cancelado')::INTEGER AS cancelado,
  COALESCE(SUM(p.valor_liquido_total), 0)::NUMERIC AS valor_total,
  c.tipo_carteira
FROM public.pedidos_compra_carteira_fornecedor c
JOIN public.administradores a ON a.id = c.administrador_id
LEFT JOIN public.pedidos_compra p
       ON public.normalize_supplier_code(p.fornecedor) = c.fornecedor_codigo
WHERE c.ativo = true
GROUP BY c.fornecedor_codigo, c.fornecedor_nome, a.id, a.nome, a.avatar_url, c.tipo_carteira
ORDER BY valor_total DESC NULLS LAST;

COMMENT ON VIEW public.vw_pedidos_carteira_fornecedor_resumo IS
  'Carteira de fornecedores de Pedidos de Compra com contagens por status, valor total e tipo_carteira (corretiva | preventiva_anual). Uso exclusivo das subabas "Corretivas" e "Preventivas Anuais".';
