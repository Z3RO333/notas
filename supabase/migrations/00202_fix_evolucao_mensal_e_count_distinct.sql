-- 00202_fix_evolucao_mensal_e_count_distinct.sql
--
-- Corrige três problemas encontrados na auditoria de performance:
--
-- 1. calcular_evolucao_mensal_admin (definida em 00201, não aplicada):
--    a) Buckets errados em em_aberto: 'aberta'/'em_tratativa' não são valores
--       retornados por classificar_status_ordem_raw(). Correto: 'em_aberto'/'em_execucao'.
--    b) Campo de data diverge da semântica do painel: a view usa
--       COALESCE(data_entrada, ordem_detectada_em) e filtra data_entrada IS NOT NULL.
--       A função estava usando ordem_detectada_em bruta, incluindo ordens sem
--       data_entrada que não aparecem no painel.
--
-- 2. calcular_kpis_ordens_operacional:
--    COUNT(DISTINCT ordem_id) → COUNT(*). filtrar_ordens_workspace_core retorna
--    uma linha por ordem (PK de ordens_notas_acompanhamento), sem duplicatas.
--    DISTINCT força hash/sort desnecessário em cada bucket.
--
-- 3. calcular_dashboard_produtividade_admin (definida em 00199, não aplicada):
--    Mesmo ajuste de COUNT(DISTINCT ordem_id) → COUNT(*) nos blocos de KPIs e rankings.
--
-- Saída funcional permanece idêntica exceto pelo bug #1 (que estava errado).
-- Nenhuma view, fonte de dados ou regra de negócio é alterada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. calcular_evolucao_mensal_admin — corrige buckets + alinha campo de data
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_admin(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ
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
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      -- Alinha com vw_ordens_notas_painel: COALESCE(data_entrada, ordem_detectada_em)
      COALESCE(o.data_entrada, o.ordem_detectada_em)                          AS data_ref,
      public.classificar_status_ordem_raw(COALESCE(o.status_ordem_raw, ''))   AS bucket
    FROM public.ordens_notas_acompanhamento o
    WHERE
      -- Alinha com vw_ordens_notas_painel: apenas ordens com data_entrada preenchida
      o.data_entrada IS NOT NULL
      AND COALESCE(o.data_entrada, o.ordem_detectada_em) >= p_data_inicio
      AND COALESCE(o.data_entrada, o.ordem_detectada_em) <  p_data_fim
  )
  SELECT
    EXTRACT(YEAR  FROM b.data_ref)::INTEGER                        AS ano,
    EXTRACT(MONTH FROM b.data_ref)::INTEGER                        AS mes,
    TO_CHAR(DATE_TRUNC('month', b.data_ref), 'Mon/YY')             AS label,
    COUNT(*) FILTER (WHERE b.bucket = 'concluida')::INTEGER        AS concluidas,
    -- Corrigido: 'em_aberto'/'em_execucao' são os valores reais do classificador
    COUNT(*) FILTER (
      WHERE b.bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao')
    )::INTEGER                                                     AS em_aberto
  FROM base b
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. calcular_kpis_ordens_operacional — COUNT(DISTINCT) → COUNT(*)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_kpis_ordens_operacional(
  p_period_mode TEXT DEFAULT 'all',
  p_year        INTEGER DEFAULT NULL,
  p_month       INTEGER DEFAULT NULL,
  p_start_iso        TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ DEFAULT NULL,
  p_status      TEXT DEFAULT NULL,
  p_unidade     TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prioridade  TEXT DEFAULT NULL,
  p_q           TEXT DEFAULT NULL,
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode        => p_period_mode,
      p_year               => p_year,
      p_month              => p_month,
      p_start_iso          => p_start_iso,
      p_end_exclusive_iso  => p_end_exclusive_iso,
      p_status             => p_status,
      p_unidade            => p_unidade,
      p_responsavel        => p_responsavel,
      p_prioridade         => p_prioridade,
      p_q                  => p_q,
      p_admin_scope        => p_admin_scope,
      p_tipo_ordem         => p_tipo_ordem
    )
  )
  SELECT json_build_object(
    'total',          COUNT(*)::INTEGER,
    'abertas',        COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
    'em_tratativa',   COUNT(*) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
    'em_avaliacao',   COUNT(*) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
    'concluidas',     COUNT(*) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
    'canceladas',     COUNT(*) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
    'avaliadas',      COUNT(*) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
    'atrasadas',      COUNT(*) FILTER (
      WHERE semaforo_atraso = 'vermelho'
        AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER,
    'sem_responsavel', COUNT(*) FILTER (
      WHERE responsavel_atual_id IS NULL
        AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER
  )
  FROM filtered;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. calcular_dashboard_produtividade_admin — COUNT(DISTINCT) → COUNT(*)
--    (função criada em 00199; esta migration assume 00199 já aplicada)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_dashboard_produtividade_admin(
  p_current_start_iso              TIMESTAMPTZ,
  p_current_end_exclusive_iso      TIMESTAMPTZ,
  p_previous_start_iso             TIMESTAMPTZ,
  p_previous_end_exclusive_iso     TIMESTAMPTZ,
  p_rolling_start_iso              TIMESTAMPTZ,
  p_rolling_end_exclusive_iso      TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH current_filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode        => 'range',
      p_year               => NULL,
      p_month              => NULL,
      p_start_iso          => p_current_start_iso,
      p_end_exclusive_iso  => p_current_end_exclusive_iso,
      p_status             => NULL,
      p_unidade            => NULL,
      p_responsavel        => NULL,
      p_prioridade         => NULL,
      p_q                  => NULL,
      p_admin_scope        => NULL,
      p_tipo_ordem         => p_tipo_ordem
    )
  ),
  previous_filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode        => 'range',
      p_year               => NULL,
      p_month              => NULL,
      p_start_iso          => p_previous_start_iso,
      p_end_exclusive_iso  => p_previous_end_exclusive_iso,
      p_status             => NULL,
      p_unidade            => NULL,
      p_responsavel        => NULL,
      p_prioridade         => NULL,
      p_q                  => NULL,
      p_admin_scope        => NULL,
      p_tipo_ordem         => p_tipo_ordem
    )
  ),
  rolling_filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode        => 'range',
      p_year               => NULL,
      p_month              => NULL,
      p_start_iso          => p_rolling_start_iso,
      p_end_exclusive_iso  => p_rolling_end_exclusive_iso,
      p_status             => NULL,
      p_unidade            => NULL,
      p_responsavel        => NULL,
      p_prioridade         => NULL,
      p_q                  => NULL,
      p_admin_scope        => NULL,
      p_tipo_ordem         => p_tipo_ordem
    )
  ),
  current_kpis AS (
    SELECT json_build_object(
      'total',          COUNT(*)::INTEGER,
      'abertas',        COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
      'em_tratativa',   COUNT(*) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
      'em_avaliacao',   COUNT(*) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
      'concluidas',     COUNT(*) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
      'canceladas',     COUNT(*) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
      'avaliadas',      COUNT(*) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
      'atrasadas',      COUNT(*) FILTER (
        WHERE semaforo_atraso = 'vermelho'
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER,
      'sem_responsavel', COUNT(*) FILTER (
        WHERE responsavel_atual_id IS NULL
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER
    ) AS payload
    FROM current_filtered
  ),
  previous_kpis AS (
    SELECT json_build_object(
      'total',          COUNT(*)::INTEGER,
      'abertas',        COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
      'em_tratativa',   COUNT(*) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
      'em_avaliacao',   COUNT(*) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
      'concluidas',     COUNT(*) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
      'canceladas',     COUNT(*) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
      'avaliadas',      COUNT(*) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
      'atrasadas',      COUNT(*) FILTER (
        WHERE semaforo_atraso = 'vermelho'
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER,
      'sem_responsavel', COUNT(*) FILTER (
        WHERE responsavel_atual_id IS NULL
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER
    ) AS payload
    FROM previous_filtered
  ),
  current_ranking AS (
    SELECT
      f.responsavel_atual_id                                                    AS administrador_id,
      COALESCE(adm.nome, 'Sem nome')                                            AS nome,
      COUNT(*)::INTEGER                                                          AS qtd_ordens_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER               AS qtd_abertas_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER             AS qtd_em_tratativa_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER               AS qtd_concluidas_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'cancelada')::INTEGER               AS qtd_canceladas_30d,
      COUNT(*) FILTER (
        WHERE f.semaforo_atraso = 'vermelho'
          AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER                                                                 AS qtd_antigas_7d_30d,
      ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
        WHERE f.dias_para_gerar_ordem IS NOT NULL
      ), 2)                                                                      AS tempo_medio_geracao_dias_30d
    FROM current_filtered f
    LEFT JOIN public.administradores adm ON adm.id = f.responsavel_atual_id
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id, adm.nome
  ),
  previous_ranking AS (
    SELECT
      f.responsavel_atual_id                                                    AS administrador_id,
      COALESCE(adm.nome, 'Sem nome')                                            AS nome,
      COUNT(*)::INTEGER                                                          AS qtd_ordens_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER               AS qtd_abertas_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER             AS qtd_em_tratativa_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER               AS qtd_concluidas_30d,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'cancelada')::INTEGER               AS qtd_canceladas_30d,
      COUNT(*) FILTER (
        WHERE f.semaforo_atraso = 'vermelho'
          AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER                                                                 AS qtd_antigas_7d_30d,
      ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
        WHERE f.dias_para_gerar_ordem IS NOT NULL
      ), 2)                                                                      AS tempo_medio_geracao_dias_30d
    FROM previous_filtered f
    LEFT JOIN public.administradores adm ON adm.id = f.responsavel_atual_id
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id, adm.nome
  ),
  monthly_evolution AS (
    SELECT
      EXTRACT(YEAR  FROM f.ordem_detectada_em AT TIME ZONE 'UTC')::INTEGER  AS ano,
      EXTRACT(MONTH FROM f.ordem_detectada_em AT TIME ZONE 'UTC')::INTEGER  AS mes,
      COUNT(*) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER           AS concluidas,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao')
      )::INTEGER                                                             AS em_aberto
    FROM rolling_filtered f
    GROUP BY 1, 2
  )
  SELECT json_build_object(
    'current_kpis',      (SELECT payload FROM current_kpis),
    'previous_kpis',     (SELECT payload FROM previous_kpis),
    'current_ranking',   COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (SELECT * FROM current_ranking  ORDER BY qtd_ordens_30d DESC, nome ASC) r
    ), '[]'::JSON),
    'previous_ranking',  COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (SELECT * FROM previous_ranking ORDER BY qtd_ordens_30d DESC, nome ASC) r
    ), '[]'::JSON),
    'monthly_evolution', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (SELECT * FROM monthly_evolution ORDER BY ano ASC, mes ASC) r
    ), '[]'::JSON)
  );
$function$;
