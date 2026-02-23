-- 00058_fix_admin_orders_ranking_scope.sql
-- Alinha ranking do dashboard administrativo com o painel de ordens:
-- 1) usa responsável atual (responsavel_atual_id) em vez de responsável de origem
-- 2) permite filtrar por tipo de ordem (PMOS/PMPL)
-- 3) aplica a mesma semântica de status usada nos KPIs operacionais

-- ============================================================
-- 1) Ranking por colaborador (com filtro p_tipo_ordem)
-- ============================================================
DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_admin(
  TIMESTAMPTZ,
  TIMESTAMPTZ
);

DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_admin(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
);

CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_admin(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_concluidas_30d INTEGER,
  qtd_canceladas_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT v.*
    FROM public.vw_ordens_notas_painel v
    WHERE v.ordem_detectada_em >= p_start_iso
      AND v.ordem_detectada_em < p_end_exclusive_iso
      AND (
        p_tipo_ordem IS NULL
        OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
        OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
      )
  )
  SELECT
    f.responsavel_atual_id AS administrador_id,
    COALESCE(f.responsavel_atual_nome, 'Sem nome') AS nome,
    COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem = 'aberta'
    )::INTEGER AS qtd_abertas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem IN ('em_tratativa', 'desconhecido')
        AND NOT public._is_em_avaliacao(f.status_ordem_raw)
        AND UPPER(TRIM(COALESCE(f.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
    )::INTEGER AS qtd_em_tratativa_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem = 'concluida'
        AND NOT public._is_avaliada(f.status_ordem_raw)
    )::INTEGER AS qtd_concluidas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem = 'cancelada'
    )::INTEGER AS qtd_canceladas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.semaforo_atraso = 'vermelho'
        AND (
          f.status_ordem = 'aberta'
          OR (
            f.status_ordem IN ('em_tratativa', 'desconhecido')
            AND NOT public._is_avaliada(f.status_ordem_raw)
          )
          OR public._is_em_avaliacao(f.status_ordem_raw)
        )
    )::INTEGER AS qtd_antigas_7d_30d,
    ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
      WHERE f.dias_para_gerar_ordem IS NOT NULL
    ), 2) AS tempo_medio_geracao_dias_30d
  FROM filtered f
  WHERE f.responsavel_atual_id IS NOT NULL
  GROUP BY f.responsavel_atual_id, f.responsavel_atual_nome
  ORDER BY qtd_ordens_30d DESC, nome ASC;
$$;

-- ============================================================
-- 2) Ranking por unidade (com filtro p_tipo_ordem)
-- ============================================================
DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_unidade(
  TIMESTAMPTZ,
  TIMESTAMPTZ
);

DROP FUNCTION IF EXISTS public.calcular_ranking_ordens_unidade(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
);

CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_unidade(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  unidade TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT v.*
    FROM public.vw_ordens_notas_painel v
    WHERE v.ordem_detectada_em >= p_start_iso
      AND v.ordem_detectada_em < p_end_exclusive_iso
      AND (
        p_tipo_ordem IS NULL
        OR NULLIF(BTRIM(p_tipo_ordem), '') IS NULL
        OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
      )
  )
  SELECT
    COALESCE(f.unidade, 'Sem unidade') AS unidade,
    COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem = 'aberta'
    )::INTEGER AS qtd_abertas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.status_ordem IN ('em_tratativa', 'desconhecido')
        AND NOT public._is_em_avaliacao(f.status_ordem_raw)
        AND UPPER(TRIM(COALESCE(f.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
    )::INTEGER AS qtd_em_tratativa_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.semaforo_atraso = 'vermelho'
        AND (
          f.status_ordem = 'aberta'
          OR (
            f.status_ordem IN ('em_tratativa', 'desconhecido')
            AND NOT public._is_avaliada(f.status_ordem_raw)
          )
          OR public._is_em_avaliacao(f.status_ordem_raw)
        )
    )::INTEGER AS qtd_antigas_7d_30d,
    ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
      WHERE f.dias_para_gerar_ordem IS NOT NULL
    ), 2) AS tempo_medio_geracao_dias_30d
  FROM filtered f
  GROUP BY COALESCE(f.unidade, 'Sem unidade')
  ORDER BY qtd_ordens_30d DESC, unidade ASC;
$$;
