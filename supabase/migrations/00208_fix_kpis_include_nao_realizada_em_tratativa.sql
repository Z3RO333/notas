-- 00208_fix_kpis_include_nao_realizada_em_tratativa.sql
--
-- Bug: ordens com status EXECUCAO_NAO_REALIZADA (raw_bucket = 'nao_realizada')
-- eram contadas no total e em 'atrasadas'/'sem_responsavel', mas nao apareciam
-- em nenhum KPI card. Isso causava total != soma dos KPIs (gap de 64 ordens).
--
-- Fix: incluir 'nao_realizada' em 'em_tratativa', consistente com
-- deriveOrdemStatusFromRaw() no frontend.

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
    'em_tratativa',   COUNT(*) FILTER (WHERE raw_bucket IN ('em_execucao', 'nao_realizada'))::INTEGER,
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
