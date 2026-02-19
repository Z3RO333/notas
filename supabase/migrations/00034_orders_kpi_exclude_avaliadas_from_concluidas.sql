-- 00034_orders_kpi_exclude_avaliadas_from_concluidas.sql
-- Garante que status raw AVALIACAO_DA_EXECUCAO nao conte em "Concluidas".

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
  p_admin_scope UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
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
      p_admin_scope => p_admin_scope
    )
  )
  SELECT json_build_object(
    'total', COUNT(DISTINCT ordem_id)::INTEGER,
    'abertas', COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'aberta')::INTEGER,
    'em_tratativa', COUNT(DISTINCT ordem_id) FILTER (
      WHERE status_ordem IN ('em_tratativa', 'desconhecido')
         OR UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
    )::INTEGER,
    'concluidas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE status_ordem = 'concluida'
        AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) <> 'AVALIACAO_DA_EXECUCAO'
    )::INTEGER,
    'canceladas', COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'cancelada')::INTEGER,
    'avaliadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
    )::INTEGER,
    'atrasadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE semaforo_atraso = 'vermelho'
        AND (
          status_ordem IN ('aberta', 'em_tratativa', 'desconhecido')
          OR UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
        )
    )::INTEGER,
    'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (WHERE responsavel_atual_id IS NULL)::INTEGER
  )
  FROM filtered;
$$;
