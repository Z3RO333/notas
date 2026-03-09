-- 00128_add_total_ordens_kpi_operacional.sql
--
-- Adiciona total_ordens ao KPI operacional.
-- total_ordens = COUNT(*) de todas as ordens no período (em andamento + concluídas + quaisquer outros status).
--
-- Isso expõe o volume total de ordens detectadas no painel Operacional.

DROP FUNCTION IF EXISTS public.calcular_kpis_operacionais(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL
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
    )::INTEGER AS lojas_atendidas,
    COUNT(*)::INTEGER AS total_ordens
  FROM base b;
END;
$$;
