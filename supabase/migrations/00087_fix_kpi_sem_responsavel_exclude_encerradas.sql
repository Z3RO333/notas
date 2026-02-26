-- 00087_fix_kpi_sem_responsavel_exclude_encerradas.sql
-- O KPI 'sem_responsavel' contava ordens concluidas/canceladas sem responsavel,
-- inflando o número com histórico irrelevante (2.740 PMOS, 308 PMPL todos encerrados).
-- Fix: contar apenas ordens ativas (status NOT IN concluida, cancelada).

CREATE OR REPLACE FUNCTION public.calcular_kpis_ordens_operacional(
  p_period_mode TEXT DEFAULT 'all',
  p_year INTEGER DEFAULT NULL,
  p_month INTEGER DEFAULT NULL,
  p_start_iso TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_unidade TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prioridade TEXT DEFAULT NULL,
  p_q TEXT DEFAULT NULL,
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace(
      p_period_mode => p_period_mode,
      p_year => p_year,
      p_month => p_month,
      p_start_iso => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status => p_status,
      p_unidade => p_unidade,
      p_responsavel => p_responsavel,
      p_prioridade => p_prioridade,
      p_q => p_q,
      p_admin_scope => p_admin_scope,
      p_tipo_ordem => p_tipo_ordem
    )
  )
  SELECT json_build_object(
    'total',          COUNT(DISTINCT ordem_id)::INTEGER,
    'abertas',        COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'aberta')::INTEGER,
    'em_tratativa',   COUNT(DISTINCT ordem_id) FILTER (
                        WHERE status_ordem IN ('em_tratativa', 'desconhecido')
                          AND NOT public._is_em_avaliacao(status_ordem_raw)
                          AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
                      )::INTEGER,
    'em_avaliacao',   COUNT(DISTINCT ordem_id) FILTER (
                        WHERE public._is_em_avaliacao(status_ordem_raw)
                      )::INTEGER,
    'concluidas',     COUNT(DISTINCT ordem_id) FILTER (
                        WHERE status_ordem = 'concluida'
                          AND NOT public._is_avaliada(status_ordem_raw)
                      )::INTEGER,
    'canceladas',     COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'cancelada')::INTEGER,
    'avaliadas',      COUNT(DISTINCT ordem_id) FILTER (
                        WHERE public._is_avaliada(status_ordem_raw)
                      )::INTEGER,
    'atrasadas',      COUNT(DISTINCT ordem_id) FILTER (
                        WHERE semaforo_atraso = 'vermelho'
                          AND (
                            status_ordem = 'aberta'
                            OR (
                              status_ordem IN ('em_tratativa', 'desconhecido')
                              AND NOT public._is_avaliada(status_ordem_raw)
                            )
                            OR public._is_em_avaliacao(status_ordem_raw)
                          )
                      )::INTEGER,
    -- Apenas ordens ATIVAS sem responsável (concluidas/canceladas são irrelevantes)
    'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (
                         WHERE responsavel_atual_id IS NULL
                           AND status_ordem NOT IN ('concluida', 'cancelada')
                       )::INTEGER
  )
  FROM filtered;
$$;
