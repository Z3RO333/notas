-- 00104_operacionais_novos_graficos.sql
-- 3 novas RPCs para os novos gráficos da página Operacional.
-- Todas usam REGEXP_REPLACE para normalizar fornecedor_codigo (sufixo SAP)
-- e JOIN em dim_operacionais para filtrar apenas operacionais cadastrados.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ordens em aberto agrupadas por loja
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_ordens_abertas_por_loja(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ,
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE(
  unidade       TEXT,
  total_abertas INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.unidade,
    COUNT(*)::INTEGER AS total_abertas
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND o.status_ordem IN ('aberta', 'em_tratativa')
    AND o.unidade IS NOT NULL
    AND BTRIM(o.unidade) <> ''
  GROUP BY o.unidade
  ORDER BY total_abertas DESC
  LIMIT p_limit;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Evolução mensal: concluídas vs em aberto
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_operacionais(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ
)
RETURNS TABLE(
  ano        INTEGER,
  mes        INTEGER,
  label      TEXT,
  concluidas INTEGER,
  em_aberto  INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXTRACT(YEAR  FROM o.ordem_detectada_em)::INTEGER AS ano,
    EXTRACT(MONTH FROM o.ordem_detectada_em)::INTEGER AS mes,
    TO_CHAR(DATE_TRUNC('month', o.ordem_detectada_em), 'Mon/YY') AS label,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER         AS concluidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta','em_tratativa'))::INTEGER AS em_aberto
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Produtividade agrupada por loja (taxa de conclusão por unidade)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_produtividade_por_loja(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ,
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE(
  unidade       TEXT,
  total_ordens  INTEGER,
  atendidas     INTEGER,
  em_aberto     INTEGER,
  pct_conclusao NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.unidade,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER                AS atendidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta','em_tratativa'))::INTEGER  AS em_aberto,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE o.status_ordem = 'concluida') * 100.0 / COUNT(*)
      END,
      1
    ) AS pct_conclusao
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND o.unidade IS NOT NULL
    AND BTRIM(o.unidade) <> ''
  GROUP BY o.unidade
  ORDER BY total_ordens DESC
  LIMIT p_limit;
END;
$$;
