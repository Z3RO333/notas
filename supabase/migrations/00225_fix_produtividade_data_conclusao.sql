-- 00225_fix_produtividade_data_conclusao.sql
--
-- Problema: todas as RPCs do módulo operacional filtravam por
-- ordem_detectada_em (data de abertura da ordem). Isso fazia com que
-- uma ordem aberta em fevereiro e concluída em abril fosse contada
-- no bucket de fevereiro — ou ficasse de fora do painel de abril.
--
-- Regra correta:
--   - Ordens CONCLUÍDAS  → usar status_atualizado_em como referência de mês
--   - Ordens EM ABERTO   → usar ordem_detectada_em (ainda estão abertas, sem data de conclusão)
--
-- Funções corrigidas:
--   calcular_kpis_operacionais
--   calcular_produtividade_operacionais
--   calcular_lojas_por_operacional
--   calcular_evolucao_mensal_operacionais
--   calcular_produtividade_por_loja
--
-- Funções inalteradas (semântica de abertura faz sentido):
--   calcular_ordens_abertas_por_loja  (mostra backlog de ordens abertas no período)
--   calcular_servicos_mais_feitos     (mostra serviços iniciados no período)

-- ── calcular_kpis_operacionais ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_operacionais   INTEGER,
  ordens_atendidas     INTEGER,
  ordens_em_aberto     INTEGER,
  lojas_atendidas      INTEGER,
  total_ordens         INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
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
    WHERE (
      -- Concluídas: contadas pelo mês em que foram concluídas
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND o.status_atualizado_em >= p_data_inicio
        AND o.status_atualizado_em < p_data_fim)
      OR
      -- Em aberto: contadas pelo mês em que foram abertas
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    COUNT(DISTINCT b.fornecedor_codigo)::INTEGER AS total_operacionais,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS ordens_atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS ordens_em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas,
    COUNT(*)::INTEGER AS total_ordens
  FROM base b;
END;
$$;

-- ── calcular_produtividade_operacionais ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_produtividade_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 50,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
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
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
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
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND o.status_atualizado_em >= p_data_inicio
        AND o.status_atualizado_em < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.fornecedor_codigo,
    b.fornecedor_nome,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END, 1
    ) AS pct_conclusao
  FROM base b
  GROUP BY b.fornecedor_codigo, b.fornecedor_nome
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

-- ── calcular_lojas_por_operacional ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_lojas_por_operacional(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
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
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
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
      -- Lojas atendidas: apenas ordens concluídas no período (data de conclusão)
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
      AND o.status_atualizado_em >= p_data_inicio
      AND o.status_atualizado_em < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
      AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.fornecedor_codigo,
    b.unidade,
    COUNT(*)::INTEGER AS qtd_atendidas
  FROM base b
  WHERE b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
  GROUP BY b.fornecedor_codigo, b.unidade
  ORDER BY b.fornecedor_codigo, qtd_atendidas DESC;
END;
$$;

-- ── calcular_evolucao_mensal_operacionais ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
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
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm,
      -- Mês de referência: conclusão para concluídas, detecção para abertas
      CASE
        WHEN UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
          THEN o.status_atualizado_em
        ELSE o.ordem_detectada_em
      END AS data_ref
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND o.status_atualizado_em >= p_data_inicio
        AND o.status_atualizado_em < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    EXTRACT(YEAR  FROM b.data_ref)::INTEGER                        AS ano,
    EXTRACT(MONTH FROM b.data_ref)::INTEGER                        AS mes,
    TO_CHAR(DATE_TRUNC('month', b.data_ref), 'Mon/YY')             AS label,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto
  FROM base b
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;

-- ── calcular_produtividade_por_loja ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_produtividade_por_loja(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 20,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
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
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
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
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND o.status_atualizado_em >= p_data_inicio
        AND o.status_atualizado_em < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.unidade,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS em_aberto,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END, 1
    ) AS pct_conclusao
  FROM base b
  WHERE b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
  GROUP BY b.unidade
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.calcular_kpis_operacionais(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) IS
  'KPIs do módulo operacional. Concluídas agrupadas por status_atualizado_em; abertas por ordem_detectada_em.';

COMMENT ON FUNCTION public.calcular_produtividade_operacionais(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, TEXT) IS
  'Ranking de produtividade por operacional. Concluídas contadas pela data real de conclusão (status_atualizado_em).';

COMMENT ON FUNCTION public.calcular_lojas_por_operacional(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) IS
  'Lojas atendidas por operacional. Usa status_atualizado_em como referência de período.';

COMMENT ON FUNCTION public.calcular_evolucao_mensal_operacionais(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) IS
  'Evolução mensal: concluídas agrupadas por status_atualizado_em, abertas por ordem_detectada_em.';

COMMENT ON FUNCTION public.calcular_produtividade_por_loja(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, TEXT) IS
  'Produtividade por loja. Concluídas contadas pela data real de conclusão (status_atualizado_em).';
