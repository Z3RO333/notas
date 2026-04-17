-- 00230_add_ordens_breakdowns_indicadores.sql
--
-- Complementa o painel de indicadores com detalhamento especifico de ordens
-- concluidas, separado da visao de notas/conversao.
--
-- Novos detalhamentos:
-- - por loja (ordem): unidade da ordem, total concluido e tempo medio de conclusao
-- - por colaborador (ordem): administrador_id da ordem, total concluido e tempo medio
--
-- Assim a tela consegue explicitar quatro blocos distintos:
-- - por loja (nota)
-- - por colaborador (nota)
-- - por loja (ordem)
-- - por colaborador (ordem)

CREATE OR REPLACE FUNCTION public.calcular_indicadores_por_loja_ordens(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  unidade                TEXT,
  ordens_concluidas      INTEGER,
  tempo_medio_conclusao  NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ordens_base AS (
    SELECT
      ona.id,
      ona.data_entrada,
      ona.concluido_em,
      COALESCE(norm.nome_canonical, unidade_ref.unidade_raw) AS unidade
    FROM public.ordens_notas_acompanhamento ona
    CROSS JOIN LATERAL (
      SELECT
        NULLIF(BTRIM(ona.unidade), '') AS unidade_raw,
        NULLIF(BTRIM(ona.centro), '')  AS centro_raw
    ) raw
    LEFT JOIN public.dim_centro_unidade dcu_unidade
      ON dcu_unidade.centro = raw.unidade_raw
     AND raw.unidade_raw ~ '^[0-9]+$'
    LEFT JOIN public.dim_centro_unidade dcu_centro
      ON dcu_centro.centro = raw.centro_raw
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        dcu_unidade.unidade,
        raw.unidade_raw,
        dcu_centro.unidade,
        raw.centro_raw
      ) AS unidade_raw
    ) unidade_ref
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = unidade_ref.unidade_raw
    WHERE ona.concluido_em IS NOT NULL
      AND ona.concluido_em >= p_start_iso
      AND ona.concluido_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
      AND unidade_ref.unidade_raw IS NOT NULL
      AND COALESCE(norm.inclui_gestao, TRUE)
  ),
  agrupado AS (
    SELECT
      ob.unidade,
      COUNT(*)::INTEGER AS ordens_concluidas,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (ob.concluido_em - ob.data_entrada)) / 86400.0
        ) FILTER (
          WHERE ob.data_entrada IS NOT NULL
        ),
        1
      ) AS tempo_medio_conclusao
    FROM ordens_base ob
    GROUP BY ob.unidade
  )
  SELECT
    a.unidade,
    a.ordens_concluidas,
    a.tempo_medio_conclusao
  FROM agrupado a
  ORDER BY a.ordens_concluidas DESC, a.unidade ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_indicadores_por_colaborador_ordens(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  administrador_id       UUID,
  nome                   TEXT,
  ordens_concluidas      INTEGER,
  tempo_medio_conclusao  NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ordens_base AS (
    SELECT
      ona.administrador_id,
      ona.data_entrada,
      ona.concluido_em
    FROM public.ordens_notas_acompanhamento ona
    WHERE ona.administrador_id IS NOT NULL
      AND ona.concluido_em IS NOT NULL
      AND ona.concluido_em >= p_start_iso
      AND ona.concluido_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
  ),
  agrupado AS (
    SELECT
      ob.administrador_id,
      COUNT(*)::INTEGER AS ordens_concluidas,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (ob.concluido_em - ob.data_entrada)) / 86400.0
        ) FILTER (
          WHERE ob.data_entrada IS NOT NULL
        ),
        1
      ) AS tempo_medio_conclusao
    FROM ordens_base ob
    GROUP BY ob.administrador_id
  )
  SELECT
    a.administrador_id,
    adm.nome,
    a.ordens_concluidas,
    a.tempo_medio_conclusao
  FROM agrupado a
  JOIN public.administradores adm
    ON adm.id = a.administrador_id
  ORDER BY a.ordens_concluidas DESC, adm.nome ASC;
$$;
