-- 00101_operacionais_filtrar_apenas_cadastrados.sql
-- Restringe as RPCs de operacionais para retornar apenas fornecedores
-- cadastrados em dim_operacionais (JOIN em vez de IS NOT NULL).

CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ
)
RETURNS TABLE(
  total_operacionais   INTEGER,
  ordens_atendidas     INTEGER,
  ordens_em_aberto     INTEGER,
  lojas_atendidas      INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT o.fornecedor_codigo)::INTEGER AS total_operacionais,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER AS ordens_atendidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta', 'em_tratativa'))::INTEGER AS ordens_em_aberto,
    COUNT(DISTINCT o.unidade) FILTER (WHERE o.status_ordem = 'concluida' AND o.unidade IS NOT NULL)::INTEGER AS lojas_atendidas
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d ON d.codigo = o.fornecedor_codigo
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_produtividade_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 50
)
RETURNS TABLE(
  fornecedor_codigo    TEXT,
  fornecedor_nome      TEXT,
  total_ordens         INTEGER,
  atendidas            INTEGER,
  em_aberto            INTEGER,
  lojas_atendidas      INTEGER,
  pct_conclusao        NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.fornecedor_codigo,
    d.nome AS fornecedor_nome,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta', 'em_tratativa'))::INTEGER AS em_aberto,
    COUNT(DISTINCT o.unidade) FILTER (WHERE o.status_ordem = 'concluida' AND o.unidade IS NOT NULL)::INTEGER AS lojas_atendidas,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE o.status_ordem = 'concluida') * 100.0 / COUNT(*)
      END,
      1
    ) AS pct_conclusao
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d ON d.codigo = o.fornecedor_codigo
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
  GROUP BY o.fornecedor_codigo, d.nome
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_servicos_mais_feitos(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 10
)
RETURNS TABLE(
  texto_breve          TEXT,
  quantidade           INTEGER,
  pct_total            NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.texto_breve,
      COUNT(*)::INTEGER AS quantidade
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d ON d.codigo = o.fornecedor_codigo
    WHERE
      o.texto_breve IS NOT NULL
      AND BTRIM(o.texto_breve) <> ''
      AND o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
    GROUP BY o.texto_breve
    ORDER BY quantidade DESC
    LIMIT p_limit
  ),
  total AS (
    SELECT COALESCE(SUM(b.quantidade), 1) AS soma FROM base b
  )
  SELECT
    b.texto_breve,
    b.quantidade,
    ROUND(b.quantidade * 100.0 / t.soma, 1) AS pct_total
  FROM base b, total t
  ORDER BY b.quantidade DESC;
END;
$$;
