-- 00251_mediana_terminal_tempo_conclusao.sql
--
-- Problema: o "tempo medio de conclusao" dos indicadores estava inflado por dois fatores:
--   1) Outliers extremos (ex: ordens canceladas com 400+ dias arrastando a media).
--   2) Status nao-terminais sendo contados como "fechados" (AVALIACAO_DA_EXECUCAO,
--      AGUARDANDO_FATURAMENTO_NF, EXECUCAO_SATISFATORIO/INSATISFATORIO).
--      Esses estagios pos-execucao podem durar semanas sem que isso reflita o
--      tempo real de fechamento operacional.
--
-- Solucao:
--   - Trocar AVG por percentile_cont(0.5) (mediana), que e robusta a outliers.
--   - Restringir a base de "ordens concluidas" aos status terminais reais:
--     CONCLUIDO, CONCLUIDA, CANCELADO, CANCELADA. Demais transicoes continuam
--     sendo registradas em concluido_em pelo trigger, mas nao entram nas
--     metricas de fechamento.
--
-- Tres RPCs sao redefinidas:
--   - calcular_kpis_notas_ordens
--   - calcular_indicadores_por_loja_ordens
--   - calcular_indicadores_por_colaborador_ordens
-- Nomes de coluna preservados (tempo_medio_conclusao) para nao quebrar UI/tests.
-- O label visivel passa a indicar "mediana" no front.

-- ── 1. KPIs principais ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_kpis_notas_ordens(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH notas_periodo AS (
    SELECT n.id
    FROM public.notas_manutencao n
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
  ),
  ordens_periodo AS (
    SELECT
      ona.nota_id,
      ona.administrador_id,
      ona.status_ordem_raw,
      ona.dias_para_gerar_ordem,
      ona.data_entrada,
      ona.concluido_em,
      ona.ordem_detectada_em
    FROM public.ordens_notas_acompanhamento ona
    WHERE (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
  ),
  convertidas AS (
    SELECT COUNT(DISTINCT op.nota_id)::INTEGER AS n
    FROM ordens_periodo op
    WHERE op.nota_id IN (SELECT id FROM notas_periodo)
  ),
  kpis_ordens AS (
    SELECT
      COUNT(*) FILTER (
        WHERE op.concluido_em IS NOT NULL
          AND op.concluido_em >= p_start_iso
          AND op.concluido_em <  p_end_exclusive_iso
          AND UPPER(BTRIM(COALESCE(op.status_ordem_raw, '')))
                IN ('CONCLUIDO','CONCLUIDA','CANCELADO','CANCELADA')
      )::INTEGER AS total_concluidas,
      ROUND(
        AVG(op.dias_para_gerar_ordem) FILTER (
          WHERE op.dias_para_gerar_ordem IS NOT NULL
            AND op.ordem_detectada_em >= p_start_iso
            AND op.ordem_detectada_em <  p_end_exclusive_iso
        ), 1
      ) AS tempo_medio_nota_ordem,
      ROUND(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (op.concluido_em - op.data_entrada)) / 86400.0
        ) FILTER (
          WHERE op.concluido_em IS NOT NULL
            AND op.data_entrada IS NOT NULL
            AND op.concluido_em >= p_start_iso
            AND op.concluido_em <  p_end_exclusive_iso
            AND UPPER(BTRIM(COALESCE(op.status_ordem_raw, '')))
                  IN ('CONCLUIDO','CONCLUIDA','CANCELADO','CANCELADA')
        )::NUMERIC, 1
      ) AS tempo_medio_conclusao
    FROM ordens_periodo op
  )
  SELECT json_build_object(
    'total_notas',             (SELECT COUNT(*)::INTEGER FROM notas_periodo),
    'notas_convertidas',       (SELECT n FROM convertidas),
    'taxa_conversao',          ROUND(
                                 CASE
                                   WHEN (SELECT COUNT(*) FROM notas_periodo) = 0 THEN 0
                                   ELSE (SELECT n FROM convertidas)::NUMERIC * 100.0
                                        / (SELECT COUNT(*) FROM notas_periodo)
                                 END, 1),
    'tempo_medio_nota_ordem',  (SELECT tempo_medio_nota_ordem FROM kpis_ordens),
    'tempo_medio_conclusao',   (SELECT tempo_medio_conclusao FROM kpis_ordens),
    'total_ordens_concluidas', (SELECT total_concluidas FROM kpis_ordens)
  );
$$;

COMMENT ON FUNCTION public.calcular_kpis_notas_ordens(TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  'KPIs do painel de indicadores. tempo_medio_conclusao = MEDIANA dos dias '
  '(concluido_em - data_entrada) restrita a ordens em status terminal real '
  '(CONCLUIDO/CANCELADO). Renomeacao adiada para nao quebrar contrato.';

-- ── 2. Por loja (ordem) ──────────────────────────────────────────────────────

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
      ona.status_ordem_raw,
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
      AND UPPER(BTRIM(COALESCE(ona.status_ordem_raw, '')))
            IN ('CONCLUIDO','CONCLUIDA','CANCELADO','CANCELADA')
      AND (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
      AND unidade_ref.unidade_raw IS NOT NULL
      AND COALESCE(norm.inclui_gestao, TRUE)
  ),
  agrupado AS (
    SELECT
      ob.unidade,
      COUNT(*)::INTEGER AS ordens_concluidas,
      ROUND(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (ob.concluido_em - ob.data_entrada)) / 86400.0
        ) FILTER (
          WHERE ob.data_entrada IS NOT NULL
        )::NUMERIC,
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

COMMENT ON FUNCTION public.calcular_indicadores_por_loja_ordens(TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  'Ranking por unidade. ordens_concluidas e tempo_medio_conclusao filtram '
  'status terminais reais (CONCLUIDO/CANCELADO). tempo_medio_conclusao = MEDIANA.';

-- ── 3. Por colaborador (ordem) ───────────────────────────────────────────────

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
      AND UPPER(BTRIM(COALESCE(ona.status_ordem_raw, '')))
            IN ('CONCLUIDO','CONCLUIDA','CANCELADO','CANCELADA')
      AND (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
  ),
  agrupado AS (
    SELECT
      ob.administrador_id,
      COUNT(*)::INTEGER AS ordens_concluidas,
      ROUND(
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (ob.concluido_em - ob.data_entrada)) / 86400.0
        ) FILTER (
          WHERE ob.data_entrada IS NOT NULL
        )::NUMERIC,
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

COMMENT ON FUNCTION public.calcular_indicadores_por_colaborador_ordens(TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  'Ranking por colaborador. Mesmo escopo de status terminal real e MEDIANA '
  'que calcular_indicadores_por_loja_ordens.';
