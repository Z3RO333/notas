-- Migration 00189: replace EXTRACT(YEAR/MONTH) with date-range predicates in filtrar_ordens_workspace
-- EXTRACT() on a timestamptz column is non-sargable — it forces a full scan even when an index exists.
-- year mode:       EXTRACT(YEAR)        = p_year           → [jan 1 p_year, jan 1 p_year+1)
-- year_month mode: EXTRACT(YEAR/MONTH)  = p_year/p_month   → [1st of month, 1st of next month)
-- month mode:      EXTRACT(MONTH)       = p_month          → inherently non-sargable (cross-year), left as-is

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace(
  p_period_mode      text                     DEFAULT 'all',
  p_year             integer                  DEFAULT NULL,
  p_month            integer                  DEFAULT NULL,
  p_start_iso        timestamp with time zone DEFAULT NULL,
  p_end_exclusive_iso timestamp with time zone DEFAULT NULL,
  p_status           text                     DEFAULT NULL,
  p_unidade          text                     DEFAULT NULL,
  p_responsavel      text                     DEFAULT NULL,
  p_prioridade       text                     DEFAULT NULL,
  p_q                text                     DEFAULT NULL,
  p_admin_scope      uuid                     DEFAULT NULL,
  p_tipo_ordem       text                     DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  WHERE
    (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)
    AND (
      COALESCE(p_period_mode, 'all') = 'all'
      OR (
        -- year: sargable range [jan 1 p_year, jan 1 p_year+1)
        p_period_mode = 'year'
        AND p_year IS NOT NULL
        AND v.ordem_detectada_em >= make_timestamptz(p_year,     1, 1, 0, 0, 0, 'UTC')
        AND v.ordem_detectada_em <  make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC')
      )
      OR (
        -- year_month: sargable range [1st of month, 1st of next month)
        p_period_mode = 'year_month'
        AND p_year  IS NOT NULL
        AND p_month IS NOT NULL
        AND v.ordem_detectada_em >= make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC')
        AND v.ordem_detectada_em <  make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC') + INTERVAL '1 month'
      )
      OR (
        -- month: cross-year, inherently non-sargable — kept as EXTRACT
        p_period_mode = 'month'
        AND p_month IS NOT NULL
        AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p_month
      )
      OR (
        p_period_mode = 'range'
        AND p_start_iso IS NOT NULL
        AND p_end_exclusive_iso IS NOT NULL
        AND v.ordem_detectada_em >= p_start_iso
        AND v.ordem_detectada_em <  p_end_exclusive_iso
      )
    )
    AND (
      p_status IS NULL
      OR p_status = ''
      OR p_status = 'todas'
      OR (
        p_status = 'ativas'
        AND v.status_ordem::TEXT NOT IN ('concluida', 'cancelada')
      )
      OR (
        p_status = 'em_avaliacao'
        AND public._is_em_avaliacao(v.status_ordem_raw)
      )
      OR (
        p_status = 'avaliadas'
        AND public._is_avaliada(v.status_ordem_raw)
      )
      OR (
        p_status = 'nao_realizada'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p_status = 'em_tratativa'
        AND v.status_ordem::TEXT = 'em_tratativa'
        AND NOT public._is_em_avaliacao(v.status_ordem_raw)
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p_status NOT IN ('ativas', 'em_avaliacao', 'avaliadas', 'nao_realizada', 'em_tratativa')
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
    )
    AND (
      p_tipo_ordem IS NULL
      OR p_tipo_ordem = ''
      OR p_tipo_ordem = 'todas'
      OR (p_tipo_ordem = 'PMPL' AND v.tipo_ordem = 'PMPL')
      OR (p_tipo_ordem = 'PMOS' AND (v.tipo_ordem IS NULL OR v.tipo_ordem <> 'PMPL'))
    );
$$;
