-- 00229_fix_indicadores_loja_notas_unidade_canonica.sql
--
-- Corrige a agregacao "por loja / unidade" dos indicadores de notas e ordens.
-- Problema observado:
-- - algumas notas chegam com denominacao_unidade vazia ou preenchida apenas com o
--   codigo numerico do centro (ex.: 104, 201, 202, 203)
-- - a RPC 00228 agrupava o valor cru e acabava exibindo/contando esses centros
--   separadamente, em vez de colapsar no canônico da unidade
--
-- Regra desejada:
-- - 104 deve entrar junto de CD MANAUS
-- - 201 deve entrar junto de Loja Porto Velho Centro
-- - 202 deve entrar junto de Loja Porto Velho Shopping
-- - 203 deve entrar junto de CD Porto Velho
--
-- Solucao:
-- 1. resolve o centro pela dim_centro_unidade quando a denominacao vier numerica
-- 2. normaliza o nome final pela dim_denominacao_norm
-- 3. respeita inclui_gestao para manter o mesmo recorte gerencial das demais RPCs

CREATE OR REPLACE FUNCTION public.calcular_indicadores_por_loja_notas(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  unidade        TEXT,
  total_notas    INTEGER,
  total_ordens   INTEGER,
  taxa_conversao NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH notas_base AS (
    SELECT
      n.id,
      COALESCE(norm.nome_canonical, unidade_ref.unidade_raw) AS unidade
    FROM public.notas_manutencao n
    CROSS JOIN LATERAL (
      SELECT
        NULLIF(BTRIM(n.denominacao_unidade), '') AS denominacao_raw,
        NULLIF(BTRIM(n.centro), '')              AS centro_raw
    ) raw
    LEFT JOIN public.dim_centro_unidade dcu_denominacao
      ON dcu_denominacao.centro = raw.denominacao_raw
     AND raw.denominacao_raw ~ '^[0-9]+$'
    LEFT JOIN public.dim_centro_unidade dcu_centro
      ON dcu_centro.centro = raw.centro_raw
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        dcu_denominacao.unidade,
        raw.denominacao_raw,
        dcu_centro.unidade,
        raw.centro_raw
      ) AS unidade_raw
    ) unidade_ref
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = unidade_ref.unidade_raw
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
      AND unidade_ref.unidade_raw IS NOT NULL
      AND COALESCE(norm.inclui_gestao, TRUE)
  ),
  agrupado AS (
    SELECT
      nb.unidade,
      COUNT(*)::INTEGER               AS total_notas,
      COUNT(DISTINCT ona.id)::INTEGER AS total_ordens
    FROM notas_base nb
    LEFT JOIN public.ordens_notas_acompanhamento ona
      ON ona.nota_id = nb.id
    GROUP BY nb.unidade
  )
  SELECT
    a.unidade,
    a.total_notas,
    a.total_ordens,
    ROUND(
      CASE
        WHEN a.total_notas = 0 THEN 0
        ELSE a.total_ordens::NUMERIC * 100.0 / a.total_notas
      END,
      1
    ) AS taxa_conversao
  FROM agrupado a
  ORDER BY a.total_notas DESC, a.unidade ASC;
$$;
