-- supabase/migrations/00228_indicadores_notas_ordens.sql
--
-- Quatro RPCs para o painel de indicadores de notas e ordens.
-- Todas aceitam p_admin_id UUID DEFAULT NULL:
--   NULL   = escopo global (gestor)
--   UUID   = carteira do admin logado
--
-- Contrato semântico:
--   Notas recebidas / convertidas → notas_manutencao.administrador_id (dono da nota)
--   Ordens concluídas / tempo conclusão → ordens_notas_acompanhamento.administrador_id
--   Agrupamento por loja → notas_manutencao.denominacao_unidade (primário)
--
-- Pré-requisito: migration 00226 (coluna concluido_em em ordens_notas_acompanhamento)

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
      )::INTEGER AS total_concluidas,
      ROUND(
        AVG(op.dias_para_gerar_ordem) FILTER (
          WHERE op.dias_para_gerar_ordem IS NOT NULL
            AND op.ordem_detectada_em >= p_start_iso
            AND op.ordem_detectada_em <  p_end_exclusive_iso
        ), 1
      ) AS tempo_medio_nota_ordem,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (op.concluido_em - op.data_entrada)) / 86400.0
        ) FILTER (
          WHERE op.concluido_em IS NOT NULL
            AND op.data_entrada IS NOT NULL
            AND COALESCE(op.concluido_em, op.ordem_detectada_em) >= p_start_iso
            AND COALESCE(op.concluido_em, op.ordem_detectada_em) <  p_end_exclusive_iso
        ), 1
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

-- ── 2. Resumo diário ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_resumo_diario_notas_ordens(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_admin_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  data_ref          DATE,
  notas_entradas    INTEGER,
  viraram_ordem     INTEGER,
  ordens_concluidas INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH dias AS (
    SELECT gs::DATE AS data_ref
    FROM generate_series(
      p_start_iso::DATE,
      (p_end_exclusive_iso - INTERVAL '1 day')::DATE,
      '1 day'::INTERVAL
    ) AS gs
  ),
  notas_dia AS (
    SELECT DATE(n.distribuida_em) AS data_ref, COUNT(*)::INTEGER AS qtd
    FROM public.notas_manutencao n
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
    GROUP BY DATE(n.distribuida_em)
  ),
  ordens_dia AS (
    SELECT DATE(ona.ordem_detectada_em) AS data_ref, COUNT(*)::INTEGER AS qtd
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.notas_manutencao n ON n.id = ona.nota_id
    WHERE ona.ordem_detectada_em >= p_start_iso
      AND ona.ordem_detectada_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
    GROUP BY DATE(ona.ordem_detectada_em)
  ),
  concluidas_dia AS (
    SELECT DATE(COALESCE(ona.concluido_em, ona.ordem_detectada_em)) AS data_ref,
           COUNT(*)::INTEGER AS qtd
    FROM public.ordens_notas_acompanhamento ona
    WHERE COALESCE(ona.concluido_em, ona.ordem_detectada_em) >= p_start_iso
      AND COALESCE(ona.concluido_em, ona.ordem_detectada_em) <  p_end_exclusive_iso
      AND ona.concluido_em IS NOT NULL
      AND (p_admin_id IS NULL OR ona.administrador_id = p_admin_id)
    GROUP BY DATE(COALESCE(ona.concluido_em, ona.ordem_detectada_em))
  )
  SELECT
    d.data_ref,
    COALESCE(nd.qtd, 0) AS notas_entradas,
    COALESCE(od.qtd, 0) AS viraram_ordem,
    COALESCE(cd.qtd, 0) AS ordens_concluidas
  FROM dias d
  LEFT JOIN notas_dia nd ON nd.data_ref = d.data_ref
  LEFT JOIN ordens_dia od ON od.data_ref = d.data_ref
  LEFT JOIN concluidas_dia cd ON cd.data_ref = d.data_ref
  ORDER BY d.data_ref;
$$;

-- ── 3. Por loja ──────────────────────────────────────────────────────────────

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
      COALESCE(NULLIF(BTRIM(n.denominacao_unidade), ''), NULLIF(BTRIM(n.centro), '')) AS unidade
    FROM public.notas_manutencao n
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND (p_admin_id IS NULL OR n.administrador_id = p_admin_id)
  ),
  agrupado AS (
    SELECT
      nb.unidade,
      COUNT(*)::INTEGER                       AS total_notas,
      COUNT(DISTINCT ona.id)::INTEGER         AS total_ordens
    FROM notas_base nb
    LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = nb.id
    WHERE nb.unidade IS NOT NULL
    GROUP BY nb.unidade
  )
  SELECT
    a.unidade,
    a.total_notas,
    a.total_ordens,
    ROUND(
      CASE WHEN a.total_notas = 0 THEN 0
           ELSE a.total_ordens::NUMERIC * 100.0 / a.total_notas
      END, 1
    ) AS taxa_conversao
  FROM agrupado a
  ORDER BY a.total_notas DESC;
$$;

-- ── 4. Por colaborador (gestor only) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_indicadores_por_colaborador(
  p_start_iso         TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS TABLE (
  administrador_id      UUID,
  nome                  TEXT,
  total_notas           INTEGER,
  notas_convertidas     INTEGER,
  taxa_conversao        NUMERIC,
  tempo_medio_nota_ordem NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH notas_periodo AS (
    SELECT n.id, n.administrador_id
    FROM public.notas_manutencao n
    WHERE n.distribuida_em >= p_start_iso
      AND n.distribuida_em <  p_end_exclusive_iso
      AND n.administrador_id IS NOT NULL
  ),
  agrupado AS (
    SELECT
      np.administrador_id,
      COUNT(*)::INTEGER                                    AS total_notas,
      COUNT(DISTINCT ona.id)::INTEGER                      AS notas_convertidas,
      ROUND(
        AVG(ona.dias_para_gerar_ordem) FILTER (
          WHERE ona.dias_para_gerar_ordem IS NOT NULL
        ), 1
      )                                                    AS tempo_medio_nota_ordem
    FROM notas_periodo np
    LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = np.id
    GROUP BY np.administrador_id
  )
  SELECT
    a.administrador_id,
    adm.nome,
    a.total_notas,
    a.notas_convertidas,
    ROUND(
      CASE WHEN a.total_notas = 0 THEN 0
           ELSE a.notas_convertidas::NUMERIC * 100.0 / a.total_notas
      END, 1
    ) AS taxa_conversao,
    a.tempo_medio_nota_ordem
  FROM agrupado a
  JOIN public.administradores adm ON adm.id = a.administrador_id
  ORDER BY a.total_notas DESC;
$$;
