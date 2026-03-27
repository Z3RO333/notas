-- 00199_dashboard_produtividade_admin_rpc.sql
--
-- Consolida a carga de produtividade dos administradores em uma unica RPC para
-- reduzir fan-out na pagina /admin e melhorar a troca de filtros.

CREATE OR REPLACE FUNCTION public.calcular_dashboard_produtividade_admin(
  p_current_start_iso TIMESTAMPTZ,
  p_current_end_exclusive_iso TIMESTAMPTZ,
  p_previous_start_iso TIMESTAMPTZ,
  p_previous_end_exclusive_iso TIMESTAMPTZ,
  p_rolling_start_iso TIMESTAMPTZ,
  p_rolling_end_exclusive_iso TIMESTAMPTZ,
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
      p_period_mode => 'range',
      p_year => NULL,
      p_month => NULL,
      p_start_iso => p_current_start_iso,
      p_end_exclusive_iso => p_current_end_exclusive_iso,
      p_status => NULL,
      p_unidade => NULL,
      p_responsavel => NULL,
      p_prioridade => NULL,
      p_q => NULL,
      p_admin_scope => NULL,
      p_tipo_ordem => p_tipo_ordem
    )
  ),
  previous_filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode => 'range',
      p_year => NULL,
      p_month => NULL,
      p_start_iso => p_previous_start_iso,
      p_end_exclusive_iso => p_previous_end_exclusive_iso,
      p_status => NULL,
      p_unidade => NULL,
      p_responsavel => NULL,
      p_prioridade => NULL,
      p_q => NULL,
      p_admin_scope => NULL,
      p_tipo_ordem => p_tipo_ordem
    )
  ),
  rolling_filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode => 'range',
      p_year => NULL,
      p_month => NULL,
      p_start_iso => p_rolling_start_iso,
      p_end_exclusive_iso => p_rolling_end_exclusive_iso,
      p_status => NULL,
      p_unidade => NULL,
      p_responsavel => NULL,
      p_prioridade => NULL,
      p_q => NULL,
      p_admin_scope => NULL,
      p_tipo_ordem => p_tipo_ordem
    )
  ),
  current_kpis AS (
    SELECT json_build_object(
      'total', COUNT(DISTINCT ordem_id)::INTEGER,
      'abertas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
      'em_tratativa', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
      'em_avaliacao', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
      'concluidas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
      'canceladas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
      'avaliadas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
      'atrasadas', COUNT(DISTINCT ordem_id) FILTER (
        WHERE semaforo_atraso = 'vermelho'
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER,
      'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (
        WHERE responsavel_atual_id IS NULL
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER
    ) AS payload
    FROM current_filtered
  ),
  previous_kpis AS (
    SELECT json_build_object(
      'total', COUNT(DISTINCT ordem_id)::INTEGER,
      'abertas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
      'em_tratativa', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_execucao')::INTEGER,
      'em_avaliacao', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
      'concluidas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
      'canceladas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
      'avaliadas', COUNT(DISTINCT ordem_id) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
      'atrasadas', COUNT(DISTINCT ordem_id) FILTER (
        WHERE semaforo_atraso = 'vermelho'
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER,
      'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (
        WHERE responsavel_atual_id IS NULL
          AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER
    ) AS payload
    FROM previous_filtered
  ),
  current_ranking AS (
    SELECT
      f.responsavel_atual_id AS administrador_id,
      COALESCE(adm.nome, 'Sem nome') AS nome,
      COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS qtd_abertas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER AS qtd_em_tratativa_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER AS qtd_concluidas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'cancelada')::INTEGER AS qtd_canceladas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.semaforo_atraso = 'vermelho'
          AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS qtd_antigas_7d_30d,
      ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
        WHERE f.dias_para_gerar_ordem IS NOT NULL
      ), 2) AS tempo_medio_geracao_dias_30d
    FROM current_filtered f
    LEFT JOIN public.administradores adm
      ON adm.id = f.responsavel_atual_id
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id, adm.nome
  ),
  previous_ranking AS (
    SELECT
      f.responsavel_atual_id AS administrador_id,
      COALESCE(adm.nome, 'Sem nome') AS nome,
      COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS qtd_abertas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER AS qtd_em_tratativa_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER AS qtd_concluidas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'cancelada')::INTEGER AS qtd_canceladas_30d,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.semaforo_atraso = 'vermelho'
          AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS qtd_antigas_7d_30d,
      ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
        WHERE f.dias_para_gerar_ordem IS NOT NULL
      ), 2) AS tempo_medio_geracao_dias_30d
    FROM previous_filtered f
    LEFT JOIN public.administradores adm
      ON adm.id = f.responsavel_atual_id
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id, adm.nome
  ),
  monthly_evolution AS (
    SELECT
      EXTRACT(YEAR FROM f.ordem_detectada_em AT TIME ZONE 'UTC')::INTEGER AS ano,
      EXTRACT(MONTH FROM f.ordem_detectada_em AT TIME ZONE 'UTC')::INTEGER AS mes,
      COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'concluida')::INTEGER AS concluidas,
      COUNT(DISTINCT f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao')
      )::INTEGER AS em_aberto
    FROM rolling_filtered f
    GROUP BY 1, 2
  )
  SELECT json_build_object(
    'current_kpis', (SELECT payload FROM current_kpis),
    'previous_kpis', (SELECT payload FROM previous_kpis),
    'current_ranking', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT *
        FROM current_ranking
        ORDER BY qtd_ordens_30d DESC, nome ASC
      ) r
    ), '[]'::JSON),
    'previous_ranking', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT *
        FROM previous_ranking
        ORDER BY qtd_ordens_30d DESC, nome ASC
      ) r
    ), '[]'::JSON),
    'monthly_evolution', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT *
        FROM monthly_evolution
        ORDER BY ano ASC, mes ASC
      ) r
    ), '[]'::JSON)
  );
$function$;
