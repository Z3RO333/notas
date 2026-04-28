-- 00241_fix_listar_equipamentos_filtros_perf.sql
--
-- listar_equipamentos_criticos_filtros estava levando ~85s após o sync
-- popular ordens_financeiro_importado com dados de 2026.
--
-- Problema 1: classificar_equipamento_critico() chamada 3x por linha
--   (SELECT + GROUP BY + HAVING). A reescrita com CTE MATERIALIZED
--   chama a função 1x por linha.
--
-- Problema 2: a função varrida o view sem filtro de categoria — ou seja,
--   lia todas as linhas, inclusive as sem texto_breve relevante.
--   Adicionado filtro de categoria para reduzir o scan.

DROP FUNCTION IF EXISTS public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.listar_equipamentos_criticos_filtros(
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL
)
RETURNS TABLE(
  equipamento   TEXT,
  total_ordens  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH classified AS MATERIALIZED (
    SELECT
      public.classificar_equipamento_critico(v.texto_breve) AS equipamento,
      v.total_ordens
    FROM public.vw_equipamentos_criticos v
    WHERE NULLIF(BTRIM(v.texto_breve), '') IS NOT NULL
      AND v.categoria IN ('elevadores', 'refrigeracao')
      AND (p_ano IS NULL      OR v.ano = p_ano)
      AND (p_mes IS NULL      OR v.mes = p_mes)
      AND (
        p_tipo_ordem IS NULL
        OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
      )
  )
  SELECT
    c.equipamento,
    SUM(c.total_ordens)::BIGINT AS total_ordens
  FROM classified c
  WHERE c.equipamento IS NOT NULL
  GROUP BY c.equipamento
  ORDER BY total_ordens DESC, c.equipamento ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) IS
  'Lista tipos de equipamento disponíveis. Usa CTE MATERIALIZED para chamar classificar_equipamento_critico() 1x por linha (antes: 3x). Filtro de categoria reduz o scan do view.';
