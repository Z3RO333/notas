-- 00162_fix_previsto_material_fallback.sql
--
-- 1. vw_financeiro_ordens: valor_previsto_pendente agora usa custos_totais_materiais
--    como fallback quando custos_estimados = 0 e custos_totais_reais = 0.
--    Caso de uso: ordens sem custo estimado mas com material ja requisitado.
--
-- 2. calcular_comparativo_financeiro_mensal / anual: total_gasto passa a ser
--    apenas valor_realizado (custo real efetivo), nao mais realizado + previsto.
--    O previsto_pendente continua disponivel como coluna separada.

-- ── 1. Recriar vw_financeiro_ordens ─────────────────────────────────────────

DROP VIEW IF EXISTS public.vw_financeiro_ordens;

CREATE VIEW public.vw_financeiro_ordens AS
SELECT
  f.id,
  f.ordem_codigo,
  f.tipo_ordem,
  f.numero_nota,
  f.data_entrada,
  f.inicio_programado,
  f.denominacao_unidade,
  f.texto_breve,
  f.fornecedor_codigo,
  f.fornecedor_nome,
  f.custos_estimados,
  f.custos_totais_materiais,
  f.custos_adicionais,
  f.custos_totais_reais,
  -- Competencia: PMPL usa inicio_programado, PMOS usa data_entrada
  CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado
    ELSE f.data_entrada
  END AS data_competencia,
  EXTRACT(YEAR FROM CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado ELSE f.data_entrada END)::INT AS competencia_ano,
  EXTRACT(MONTH FROM CASE
    WHEN f.tipo_ordem = 'PMPL' AND f.inicio_programado IS NOT NULL
      THEN f.inicio_programado ELSE f.data_entrada END)::INT AS competencia_mes,
  -- Realizado: custo real efetivo
  GREATEST(COALESCE(f.custos_totais_reais, 0), 0::NUMERIC) AS valor_realizado,
  -- Previsto pendente: estimado quando disponivel, fallback para material
  CASE
    WHEN COALESCE(f.custos_totais_reais, 0) > 0
      THEN 0::NUMERIC
    WHEN COALESCE(f.custos_estimados, 0) > 0
      THEN GREATEST(COALESCE(f.custos_estimados, 0), 0::NUMERIC)
    ELSE
      GREATEST(COALESCE(f.custos_totais_materiais, 0), 0::NUMERIC)
  END AS valor_previsto_pendente,
  (COALESCE(f.custos_totais_reais, 0) > 0) AS tem_custo_real,
  GREATEST(
    COALESCE(f.custos_totais_reais, 0)
      - COALESCE(f.custos_totais_materiais, 0)
      - COALESCE(f.custos_adicionais, 0),
    0::NUMERIC
  ) AS valor_servico_calculado,
  f.source_file_name,
  f.imported_by,
  f.importado_em,
  f.created_at,
  f.updated_at
FROM public.ordens_financeiro_importado f
WHERE BTRIM(f.ordem_codigo) <> '';

ALTER VIEW public.vw_financeiro_ordens SET (security_invoker = on);

COMMENT ON VIEW public.vw_financeiro_ordens IS
  'Camada de leitura financeira. Competencia: PMPL=inicio_programado, PMOS=data_entrada.
   valor_previsto_pendente: custos_estimados quando preenchido, fallback custos_totais_materiais.';

-- ── 2. Atualizar RPC mensal: total_gasto = valor_realizado ──────────────────

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
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric)          AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric)  AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  ),
  agg AS (
    SELECT
      b.ano,
      b.mes,
      COUNT(*)::integer                        AS total_ordens,
      -- total_gasto = apenas o custo real efetivo (nao inclui previsto pendente)
      SUM(b.valor_realizado)::numeric          AS total_gasto,
      SUM(b.valor_realizado)::numeric          AS valor_realizado,
      SUM(b.valor_previsto_pendente)::numeric  AS valor_previsto_pendente
    FROM base b
    GROUP BY b.ano, b.mes
  )
  SELECT
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0)              AS total_ordens,
    COALESCE(a.total_gasto, 0::numeric)      AS total_gasto,
    COALESCE(a.valor_realizado, 0::numeric)  AS valor_realizado,
    COALESCE(a.valor_previsto_pendente, 0::numeric) AS valor_previsto_pendente
  FROM selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a ON a.ano = y.ano AND a.mes = m.mes
  ORDER BY y.ano ASC, m.mes ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_mensal(integer, integer, text) IS
  'Comparativo mensal financeiro. total_gasto = valor_realizado (custo efetivo).
   valor_previsto_pendente separado inclui fallback para custos_totais_materiais.';

-- ── 3. Recriar RPC anual derivado ───────────────────────────────────────────

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
    SUM(m.total_ordens)::integer          AS total_ordens,
    SUM(m.total_gasto)::numeric           AS total_gasto,
    SUM(m.valor_realizado)::numeric       AS valor_realizado,
    SUM(m.valor_previsto_pendente)::numeric AS valor_previsto_pendente
  FROM public.calcular_comparativo_financeiro_mensal(
    p_ano_base, p_ano_comparado, p_tipo_ordem
  ) m
  GROUP BY m.ano
  ORDER BY m.ano ASC;
$$;

COMMENT ON FUNCTION public.calcular_comparativo_financeiro_anual(integer, integer, text) IS
  'Resumo anual derivado do comparativo mensal. total_gasto = valor_realizado.';
