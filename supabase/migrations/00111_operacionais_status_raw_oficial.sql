-- 00111_operacionais_status_raw_oficial.sql
-- Ajusta metricas do painel Operacional para usar status_ordem_raw oficial.
-- Escopo: somente RPCs do modulo /admin/operacional.

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
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    COUNT(DISTINCT b.fornecedor_codigo)::INTEGER AS total_operacionais,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS ordens_atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER AS ordens_em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL
        AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas
  FROM base b;
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
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      d.nome AS fornecedor_nome,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    b.fornecedor_codigo,
    b.fornecedor_nome,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER AS em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL
        AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END,
      1
    ) AS pct_conclusao
  FROM base b
  GROUP BY b.fornecedor_codigo, b.fornecedor_nome
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
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
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    b.fornecedor_codigo,
    b.unidade,
    COUNT(*)::INTEGER AS qtd_atendidas
  FROM base b
  WHERE
    b.raw_norm = ANY(v_status_concluidos)
    AND b.unidade IS NOT NULL
    AND BTRIM(b.unidade) <> ''
  GROUP BY b.fornecedor_codigo, b.unidade
  ORDER BY b.fornecedor_codigo, qtd_atendidas DESC;
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
DECLARE
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    b.unidade,
    COUNT(*)::INTEGER AS total_abertas
  FROM base b
  WHERE
    b.raw_norm = ANY(v_status_abertos)
    AND b.unidade IS NOT NULL
    AND BTRIM(b.unidade) <> ''
  GROUP BY b.unidade
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
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.ordem_detectada_em,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    EXTRACT(YEAR FROM b.ordem_detectada_em)::INTEGER AS ano,
    EXTRACT(MONTH FROM b.ordem_detectada_em)::INTEGER AS mes,
    TO_CHAR(DATE_TRUNC('month', b.ordem_detectada_em), 'Mon/YY') AS label,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER AS em_aberto
  FROM base b
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
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
  )
  SELECT
    b.unidade,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER AS em_aberto,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END,
      1
    ) AS pct_conclusao
  FROM base b
  WHERE
    b.unidade IS NOT NULL
    AND BTRIM(b.unidade) <> ''
  GROUP BY b.unidade
  ORDER BY total_ordens DESC
  LIMIT p_limit;
END;
$$;
