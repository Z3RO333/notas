-- 00038_orders_status_semantics_refine.sql
-- Ajusta semântica dos status raw no workspace de ordens:
-- - em_avaliacao  -> AVALIACAO_DA_EXECUCAO
-- - avaliadas     -> EXECUCAO_SATISFATORIO
-- - nao_realizada -> EXECUCAO_NAO_REALIZADA
-- E mantém EQUIPAMENTO_EM_CONSERTO dentro de em_execucao (via em_tratativa).

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace(
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
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  WHERE
    (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)
    AND (
      COALESCE(p_period_mode, 'all') = 'all'
      OR (
        p_period_mode = 'year'
        AND p_year IS NOT NULL
        AND EXTRACT(YEAR FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_year
      )
      OR (
        p_period_mode = 'year_month'
        AND p_year IS NOT NULL
        AND p_month IS NOT NULL
        AND EXTRACT(YEAR FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_year
        AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_month
      )
      OR (
        p_period_mode = 'month'
        AND p_month IS NOT NULL
        AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_month
      )
      OR (
        p_period_mode = 'range'
        AND p_start_iso IS NOT NULL
        AND p_end_exclusive_iso IS NOT NULL
        AND v.ordem_detectada_em >= p_start_iso
        AND v.ordem_detectada_em < p_end_exclusive_iso
      )
    )
    AND (
      p_status IS NULL
      OR p_status = ''
      OR p_status = 'todas'
      OR (
        p_status = 'em_avaliacao'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
      )
      OR (
        p_status = 'avaliadas'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'EXECUCAO_SATISFATORIO'
      )
      OR (
        p_status = 'nao_realizada'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p_status = 'em_tratativa'
        AND v.status_ordem::TEXT = 'em_tratativa'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) NOT IN ('AVALIACAO_DA_EXECUCAO', 'EXECUCAO_NAO_REALIZADA')
      )
      OR (
        p_status NOT IN ('em_avaliacao', 'avaliadas', 'nao_realizada', 'em_tratativa')
        AND v.status_ordem::TEXT = p_status
      )
    )
    AND (
      p_unidade IS NULL
      OR p_unidade = ''
      OR p_unidade = 'todas'
      OR v.unidade = p_unidade
    )
    AND (
      p_responsavel IS NULL
      OR p_responsavel = ''
      OR p_responsavel = 'todos'
      OR (
        p_responsavel = '__sem_atual__'
        AND v.responsavel_atual_id IS NULL
      )
      OR (
        p_responsavel <> '__sem_atual__'
        AND v.responsavel_atual_id::TEXT = p_responsavel
      )
    )
    AND (
      p_prioridade IS NULL
      OR p_prioridade = ''
      OR p_prioridade = 'todas'
      OR v.semaforo_atraso = p_prioridade
    )
    AND (
      p_q IS NULL
      OR p_q = ''
      OR v.numero_nota ILIKE ('%' || p_q || '%')
      OR v.ordem_codigo ILIKE ('%' || p_q || '%')
      OR COALESCE(v.descricao, '') ILIKE ('%' || p_q || '%')
    );
$$;

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
        AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) NOT IN ('AVALIACAO_DA_EXECUCAO', 'EXECUCAO_NAO_REALIZADA')
    )::INTEGER,
    'em_avaliacao', COUNT(DISTINCT ordem_id) FILTER (
      WHERE UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
    )::INTEGER,
    'concluidas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE status_ordem = 'concluida'
        AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) <> 'EXECUCAO_SATISFATORIO'
    )::INTEGER,
    'canceladas', COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'cancelada')::INTEGER,
    'avaliadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'EXECUCAO_SATISFATORIO'
    )::INTEGER,
    'atrasadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE semaforo_atraso = 'vermelho'
        AND (
          status_ordem = 'aberta'
          OR (
            status_ordem IN ('em_tratativa', 'desconhecido')
            AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) NOT IN ('AVALIACAO_DA_EXECUCAO', 'EXECUCAO_NAO_REALIZADA')
          )
          OR UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
        )
    )::INTEGER,
    'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (WHERE responsavel_atual_id IS NULL)::INTEGER
  )
  FROM filtered;
$$;
