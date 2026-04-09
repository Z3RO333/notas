-- 00105_operacionais_filtro_por_pessoa.sql
-- Adiciona parâmetro opcional p_fornecedor_codigo TEXT DEFAULT NULL a todas as
-- RPCs operacionais, permitindo filtrar estatísticas por um colaborador específico.
-- Quando NULL (padrão), retorna todos os operacionais cadastrados.

CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo);
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_produtividade_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 50,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  GROUP BY o.fornecedor_codigo, d.nome
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_servicos_mais_feitos(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 10,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.texto_breve IS NOT NULL
      AND BTRIM(o.texto_breve) <> ''
      AND o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
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

CREATE OR REPLACE FUNCTION public.calcular_lojas_por_operacional(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_codigo TEXT,
  unidade           TEXT,
  qtd_atendidas     INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.fornecedor_codigo,
    o.unidade,
    COUNT(*)::INTEGER AS qtd_atendidas
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND o.status_ordem = 'concluida'
    AND o.unidade IS NOT NULL
    AND BTRIM(o.unidade) <> ''
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  GROUP BY o.fornecedor_codigo, o.unidade
  ORDER BY o.fornecedor_codigo, qtd_atendidas DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_ordens_abertas_por_loja(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 20,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  GROUP BY o.unidade
  ORDER BY total_abertas DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_produtividade_por_loja(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 20,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  GROUP BY o.unidade
  ORDER BY total_ordens DESC
  LIMIT p_limit;
END;
$$;
