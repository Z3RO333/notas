-- 00046_fix_buscar_ordens_prioritarias_return_type.sql
-- Recria buscar_ordens_prioritarias_dashboard após a migration 00045 ter adicionado
-- a coluna tipo_ordem à view vw_ordens_notas_painel.
--
-- Contexto: CREATE OR REPLACE VIEW não invalida automaticamente funções que
-- retornam SETOF dessa view. É necessário recriar (DROP + CREATE) a função
-- para que o PostgreSQL resolva o novo tipo de retorno com tipo_ordem incluído.

DROP FUNCTION IF EXISTS public.buscar_ordens_prioritarias_dashboard(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);

CREATE FUNCTION public.buscar_ordens_prioritarias_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
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
  ORDER BY
    CASE v.semaforo_atraso
      WHEN 'vermelho' THEN 3
      WHEN 'amarelo' THEN 2
      WHEN 'verde' THEN 1
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
