-- 00048_buscar_ordens_prioritarias_tipo_ordem.sql
-- Adiciona p_tipo_ordem (DEFAULT NULL = todos) à função buscar_ordens_prioritarias_dashboard
-- para permitir filtrar PMOS e PMPL separadamente no dashboard admin.

DROP FUNCTION IF EXISTS public.buscar_ordens_prioritarias_dashboard(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.buscar_ordens_prioritarias_dashboard(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT);

CREATE FUNCTION public.buscar_ordens_prioritarias_dashboard(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_limit             INTEGER DEFAULT 20,
  p_tipo_ordem        TEXT    DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  JOIN public.ordens_notas_acompanhamento o ON o.id = v.ordem_id
  WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) >= p_start_iso
    AND COALESCE(o.data_entrada, o.ordem_detectada_em) < p_end_exclusive_iso
    AND (p_tipo_ordem IS NULL OR v.tipo_ordem = p_tipo_ordem)
  ORDER BY
    CASE v.semaforo_atraso
      WHEN 'vermelho' THEN 3
      WHEN 'amarelo'  THEN 2
      WHEN 'verde'    THEN 1
      ELSE 0
    END DESC,
    CASE
      WHEN v.status_ordem IN ('concluida', 'cancelada') THEN 0
      ELSE 1
    END DESC,
    COALESCE(o.data_entrada, o.ordem_detectada_em) DESC,
    v.ordem_codigo ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 1000);
$$;
