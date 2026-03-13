-- 00161_comparativos_anuais.sql
--
-- Nova camada de comparativos anuais para a area admin/comparativos.
-- Objetivo:
-- 1. Comparar dois anos por vez para ordens e financeiro.
-- 2. Reaproveitar a mesma semantica de status usada no dashboard operacional.
-- 3. Manter a agregacao principal no banco para evitar SSR pesado.

CREATE OR REPLACE FUNCTION public.listar_comparativo_anos()
RETURNS TABLE(
  ano integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH years AS (
    SELECT g.ano
    FROM public.listar_gestao_filtros() g
    WHERE g.ano IS NOT NULL

    UNION

    SELECT DISTINCT v.competencia_ano AS ano
    FROM public.vw_financeiro_ordens v
    WHERE v.competencia_ano IS NOT NULL
  )
  SELECT y.ano
  FROM years y
  ORDER BY y.ano DESC;
$$;

COMMENT ON FUNCTION public.listar_comparativo_anos() IS
  'Lista anos disponiveis para a pagina de comparativos anuais.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_ordens_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  mes integer,
  total_ordens integer,
  ordens_abertas integer,
  ordens_executadas integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  months AS (
    SELECT GENERATE_SERIES(1, 12)::integer AS mes
  ),
  base AS MATERIALIZED (
    SELECT
      b.ano,
      b.mes,
      UPPER(BTRIM(COALESCE(b.status_ordem_raw, ''))) AS raw_norm
    FROM selected_years y
    CROSS JOIN LATERAL public.listar_gestao_ordens_base_filtrada(
      y.ano,
      NULL,
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    ) b
  ),
  agg AS (
    SELECT
      b.ano,
      b.mes,
      COUNT(*)::integer AS total_ordens,
      COUNT(*) FILTER (
        WHERE b.raw_norm = ANY(ARRAY[
          'ABERTO',
          'ABERTA',
          'EM_EXECUCAO',
          'EQUIPAMENTO_EM_CONSERTO',
          'EXECUCAO_NAO_REALIZADA',
          'ENVIAR_EMAIL_PFORNECEDOR',
          'EM_PROCESSAMENTO',
          'EXECUCAO_INSATISFATORIO'
        ]::text[])
      )::integer AS ordens_abertas,
      COUNT(*) FILTER (
        WHERE b.raw_norm = ANY(ARRAY[
          'CANCELADO',
          'CANCELADA',
          'CONCLUIDO',
          'CONCLUIDA',
          'AGUARDANDO_FATURAMENTO_NF',
          'EXECUCAO_SATISFATORIO',
          'EXECUCAO_SATISFATORIA',
          'AVALIACAO_DA_EXECUCAO',
          'AVALIACAO_DE_EXECUCAO'
        ]::text[])
      )::integer AS ordens_executadas
    FROM base b
    GROUP BY b.ano, b.mes
  )
  SELECT
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.ordens_abertas, 0) AS ordens_abertas,
    COALESCE(a.ordens_executadas, 0) AS ordens_executadas
  FROM selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  ORDER BY y.ano ASC, m.mes ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_ordens_mensal(integer, integer, text) IS
  'Comparativo mensal de ordens para dois anos. Buckets abertas/executadas seguem a mesma semantica do dashboard operacional.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_ordens_anual(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  total_ordens integer,
  ordens_abertas integer,
  ordens_executadas integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.ano,
    SUM(m.total_ordens)::integer AS total_ordens,
    SUM(m.ordens_abertas)::integer AS ordens_abertas,
    SUM(m.ordens_executadas)::integer AS ordens_executadas
  FROM public.calcular_comparativo_ordens_mensal(
    p_ano_base,
    p_ano_comparado,
    p_tipo_ordem
  ) m
  GROUP BY m.ano
  ORDER BY m.ano ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_ordens_anual(integer, integer, text) IS
  'Resumo anual derivado do comparativo mensal de ordens.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  mes integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  months AS (
    SELECT GENERATE_SERIES(1, 12)::integer AS mes
  ),
  base AS MATERIALIZED (
    SELECT
      v.competencia_ano AS ano,
      v.competencia_mes AS mes,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  ),
  agg AS (
    SELECT
      b.ano,
      b.mes,
      COUNT(*)::integer AS total_ordens,
      SUM(b.valor_realizado + b.valor_previsto_pendente)::numeric AS total_gasto,
      SUM(b.valor_realizado)::numeric AS valor_realizado,
      SUM(b.valor_previsto_pendente)::numeric AS valor_previsto_pendente
    FROM base b
    GROUP BY b.ano, b.mes
  )
  SELECT
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.total_gasto, 0::numeric) AS total_gasto,
    COALESCE(a.valor_realizado, 0::numeric) AS valor_realizado,
    COALESCE(a.valor_previsto_pendente, 0::numeric) AS valor_previsto_pendente
  FROM selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  ORDER BY y.ano ASC, m.mes ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_mensal(integer, integer, text) IS
  'Comparativo mensal financeiro para dois anos com competencia alinhada a vw_financeiro_ordens.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_anual(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.ano,
    SUM(m.total_ordens)::integer AS total_ordens,
    SUM(m.total_gasto)::numeric AS total_gasto,
    SUM(m.valor_realizado)::numeric AS valor_realizado,
    SUM(m.valor_previsto_pendente)::numeric AS valor_previsto_pendente
  FROM public.calcular_comparativo_financeiro_mensal(
    p_ano_base,
    p_ano_comparado,
    p_tipo_ordem
  ) m
  GROUP BY m.ano
  ORDER BY m.ano ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_anual(integer, integer, text) IS
  'Resumo anual derivado do comparativo mensal financeiro.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_fornecedores_anual(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_ref text,
  fornecedor_codigo text,
  fornecedor_nome text,
  ano integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  base AS MATERIALIZED (
    SELECT
      COALESCE(
        NULLIF(BTRIM(v.fornecedor_codigo), ''),
        '__nome__:' || LOWER(
          REGEXP_REPLACE(
            COALESCE(NULLIF(BTRIM(v.fornecedor_nome), ''), 'Sem fornecedor'),
            '\s+',
            ' ',
            'g'
          )
        )
      ) AS fornecedor_ref,
      NULLIF(BTRIM(v.fornecedor_codigo), '') AS fornecedor_codigo,
      NULLIF(BTRIM(v.fornecedor_nome), '') AS fornecedor_nome,
      v.competencia_ano AS ano,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  )
  SELECT
    b.fornecedor_ref,
    MAX(b.fornecedor_codigo) AS fornecedor_codigo,
    COALESCE(
      MAX(b.fornecedor_nome) FILTER (WHERE b.fornecedor_nome IS NOT NULL),
      'Sem fornecedor'
    ) AS fornecedor_nome,
    b.ano,
    COUNT(*)::integer AS total_ordens,
    SUM(b.valor_realizado + b.valor_previsto_pendente)::numeric AS total_gasto,
    SUM(b.valor_realizado)::numeric AS valor_realizado,
    SUM(b.valor_previsto_pendente)::numeric AS valor_previsto_pendente
  FROM base b
  GROUP BY b.fornecedor_ref, b.ano
  ORDER BY b.ano ASC, total_gasto DESC, fornecedor_nome ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_fornecedores_anual(integer, integer, text) IS
  'Resumo anual por fornecedor para dois anos com fallback estavel quando nao houver codigo do fornecedor.';

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_fornecedor_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL,
  p_fornecedor_codigo text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_ref text,
  fornecedor_codigo text,
  fornecedor_nome text,
  ano integer,
  mes integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  months AS (
    SELECT GENERATE_SERIES(1, 12)::integer AS mes
  ),
  base AS MATERIALIZED (
    SELECT
      COALESCE(
        NULLIF(BTRIM(v.fornecedor_codigo), ''),
        '__nome__:' || LOWER(
          REGEXP_REPLACE(
            COALESCE(NULLIF(BTRIM(v.fornecedor_nome), ''), 'Sem fornecedor'),
            '\s+',
            ' ',
            'g'
          )
        )
      ) AS fornecedor_ref,
      NULLIF(BTRIM(v.fornecedor_codigo), '') AS fornecedor_codigo,
      NULLIF(BTRIM(v.fornecedor_nome), '') AS fornecedor_nome,
      v.competencia_ano AS ano,
      v.competencia_mes AS mes,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE p_fornecedor_codigo IS NOT NULL
      AND fornecedor_ref = p_fornecedor_codigo
  ),
  supplier_meta AS (
    SELECT
      MAX(fornecedor_ref) AS fornecedor_ref,
      MAX(fornecedor_codigo) AS fornecedor_codigo,
      COALESCE(
        MAX(fornecedor_nome) FILTER (WHERE fornecedor_nome IS NOT NULL),
        'Sem fornecedor'
      ) AS fornecedor_nome
    FROM filtered
  ),
  agg AS (
    SELECT
      f.ano,
      f.mes,
      COUNT(*)::integer AS total_ordens,
      SUM(f.valor_realizado + f.valor_previsto_pendente)::numeric AS total_gasto,
      SUM(f.valor_realizado)::numeric AS valor_realizado,
      SUM(f.valor_previsto_pendente)::numeric AS valor_previsto_pendente
    FROM filtered f
    GROUP BY f.ano, f.mes
  )
  SELECT
    s.fornecedor_ref,
    s.fornecedor_codigo,
    s.fornecedor_nome,
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.total_gasto, 0::numeric) AS total_gasto,
    COALESCE(a.valor_realizado, 0::numeric) AS valor_realizado,
    COALESCE(a.valor_previsto_pendente, 0::numeric) AS valor_previsto_pendente
  FROM supplier_meta s
  CROSS JOIN selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  WHERE s.fornecedor_ref IS NOT NULL
  ORDER BY y.ano ASC, m.mes ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_fornecedor_mensal(integer, integer, text, text) IS
  'Detalhe mensal de um fornecedor para dois anos, com 12 meses normalizados por ano.';
