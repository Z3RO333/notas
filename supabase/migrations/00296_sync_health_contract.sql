-- 00296_sync_health_contract.sql
--
-- Contrato operacional para diagnosticar a saude dos jobs de sync a partir de
-- sync_log. Mantem sync_log como fonte de verdade e expoe um resumo pronto para
-- dashboard/alertas, incluindo falhas toleradas gravadas dentro de metadata.

CREATE INDEX IF NOT EXISTS idx_sync_log_job_started_at
  ON public.sync_log (
    (LOWER(COALESCE(NULLIF(metadata->>'job', ''), NULLIF(metadata->>'job_type', ''), databricks_job_id, 'dispatcher'))),
    started_at DESC
  );

CREATE OR REPLACE VIEW public.vw_sync_health AS
WITH base AS (
  SELECT
    s.id,
    LOWER(COALESCE(NULLIF(s.metadata->>'job', ''), NULLIF(s.metadata->>'job_type', ''), s.databricks_job_id, 'dispatcher')) AS job_name,
    s.started_at,
    s.finished_at,
    s.status,
    COALESCE(s.notas_lidas, 0) AS notas_lidas,
    COALESCE(s.notas_inseridas, 0) AS notas_inseridas,
    COALESCE(s.notas_atualizadas, 0) AS notas_atualizadas,
    COALESCE(s.notas_distribuidas, 0) AS notas_distribuidas,
    s.erro_mensagem,
    s.databricks_job_id,
    COALESCE(s.metadata, '{}'::jsonb) AS metadata,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(COALESCE(NULLIF(s.metadata->>'job', ''), NULLIF(s.metadata->>'job_type', ''), s.databricks_job_id, 'dispatcher'))
      ORDER BY s.started_at DESC
    ) AS rn
  FROM public.sync_log s
),
latest AS (
  SELECT *
  FROM base
  WHERE rn = 1
),
signals AS (
  SELECT
    l.id,
    COUNT(*) FILTER (
      WHERE e.key LIKE '%\_status' ESCAPE '\'
        AND LOWER(e.value) IN ('error', 'error_tolerated', 'error_required')
    )::INTEGER AS internal_status_error_count,
    COUNT(*) FILTER (
      WHERE e.key LIKE '%\_error' ESCAPE '\'
        AND NULLIF(BTRIM(e.value), '') IS NOT NULL
        AND LOWER(BTRIM(e.value)) NOT IN ('none', 'null')
    )::INTEGER AS internal_error_message_count,
    BOOL_OR(
      e.key LIKE '%\_status' ESCAPE '\'
      AND LOWER(e.value) = 'error_required'
    ) AS has_required_internal_error,
    ARRAY_REMOVE(ARRAY_AGG(e.key ORDER BY e.key) FILTER (
      WHERE (
        e.key LIKE '%\_status' ESCAPE '\'
        AND LOWER(e.value) IN ('error', 'error_tolerated', 'error_required')
      )
      OR (
        e.key LIKE '%\_error' ESCAPE '\'
        AND NULLIF(BTRIM(e.value), '') IS NOT NULL
        AND LOWER(BTRIM(e.value)) NOT IN ('none', 'null')
      )
    ), NULL) AS internal_error_keys
  FROM latest l
  LEFT JOIN LATERAL jsonb_each_text(l.metadata) e(key, value) ON TRUE
  GROUP BY l.id
),
classified AS (
  SELECT
    l.*,
    CASE l.job_name
      WHEN 'fast' THEN 20
      WHEN 'medium' THEN 180
      WHEN 'heavy' THEN 720
      ELSE 90
    END AS critical_after_minutes,
    CASE l.job_name
      WHEN 'fast' THEN 10
      WHEN 'medium' THEN 90
      WHEN 'heavy' THEN 360
      ELSE 45
    END AS warning_after_minutes,
    FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(l.finished_at, l.started_at))) / 60)::INTEGER AS minutes_since_last_event,
    FLOOR(EXTRACT(EPOCH FROM (COALESCE(l.finished_at, NOW()) - l.started_at)) / 60)::INTEGER AS runtime_minutes,
    CASE
      WHEN l.metadata->>'processing_duration_ms' ~ '^[0-9]+(\.[0-9]+)?$'
        THEN ROUND((l.metadata->>'processing_duration_ms')::NUMERIC)::BIGINT
      ELSE NULL
    END AS processing_duration_ms,
    CASE
      WHEN l.metadata->>'source_total_rows' ~ '^[0-9]+$'
        THEN (l.metadata->>'source_total_rows')::INTEGER
      ELSE NULL
    END AS source_total_rows,
    CASE
      WHEN l.metadata->>'source_rows_read' ~ '^[0-9]+$'
        THEN (l.metadata->>'source_rows_read')::INTEGER
      ELSE NULL
    END AS source_rows_read,
    COALESCE(s.internal_status_error_count, 0) + COALESCE(s.internal_error_message_count, 0) AS internal_error_count,
    COALESCE(s.has_required_internal_error, FALSE) AS has_required_internal_error,
    COALESCE(s.internal_error_keys, ARRAY[]::TEXT[]) AS internal_error_keys
  FROM latest l
  LEFT JOIN signals s ON s.id = l.id
),
health AS (
  SELECT
    c.*,
    (
      c.job_name = 'fast'
      AND c.status = 'success'
      AND c.source_total_rows = 0
    ) AS source_empty_suspect,
    (
      c.status <> 'running'
      AND c.minutes_since_last_event > c.critical_after_minutes
    ) AS is_stale,
    (
      c.status <> 'running'
      AND c.minutes_since_last_event > c.warning_after_minutes
    ) AS is_warning_stale,
    (
      c.status = 'running'
      AND c.runtime_minutes > c.critical_after_minutes
    ) AS is_long_running,
    (
      c.status = 'running'
      AND c.runtime_minutes > c.warning_after_minutes
    ) AS is_warning_running
  FROM classified c
)
SELECT
  h.id AS sync_id,
  h.job_name,
  h.started_at,
  h.finished_at,
  h.status,
  CASE
    WHEN h.status = 'error'
      OR h.has_required_internal_error
      OR h.source_empty_suspect
      OR h.is_stale
      OR h.is_long_running
      THEN 'critical'
    WHEN h.internal_error_count > 0
      OR h.is_warning_stale
      OR h.is_warning_running
      THEN 'warning'
    ELSE 'ok'
  END AS health_status,
  CASE
    WHEN h.status = 'error' THEN 'Ultimo sync terminou com erro.'
    WHEN h.has_required_internal_error THEN 'Etapa interna obrigatoria registrou erro.'
    WHEN h.source_empty_suspect THEN 'Fonte primaria do fast sync retornou zero linhas.'
    WHEN h.is_stale THEN FORMAT('Ultimo evento ha %s min; limite critico %s min.', h.minutes_since_last_event, h.critical_after_minutes)
    WHEN h.is_long_running THEN FORMAT('Sync em execucao ha %s min; limite critico %s min.', h.runtime_minutes, h.critical_after_minutes)
    WHEN h.internal_error_count > 0 THEN 'Sync concluiu com falha interna tolerada.'
    WHEN h.is_warning_stale THEN FORMAT('Ultimo evento ha %s min; limite de aviso %s min.', h.minutes_since_last_event, h.warning_after_minutes)
    WHEN h.is_warning_running THEN FORMAT('Sync em execucao ha %s min; limite de aviso %s min.', h.runtime_minutes, h.warning_after_minutes)
    ELSE 'Sync saudavel.'
  END AS health_reason,
  CASE
    WHEN h.status = 'error'
      OR h.has_required_internal_error
      OR h.source_empty_suspect
      OR h.is_stale
      OR h.is_long_running
      THEN 2
    WHEN h.internal_error_count > 0
      OR h.is_warning_stale
      OR h.is_warning_running
      THEN 1
    ELSE 0
  END AS health_rank,
  h.minutes_since_last_event,
  h.runtime_minutes,
  h.warning_after_minutes,
  h.critical_after_minutes,
  h.notas_lidas,
  h.notas_inseridas,
  h.notas_atualizadas,
  h.notas_distribuidas,
  h.source_total_rows,
  h.source_rows_read,
  h.processing_duration_ms,
  h.internal_error_count,
  h.internal_error_keys,
  h.erro_mensagem,
  h.databricks_job_id,
  h.metadata
FROM health h;

COMMENT ON VIEW public.vw_sync_health IS
  'Resumo operacional do ultimo sync por job, com staleness, fonte vazia e erros internos em metadata.';

CREATE OR REPLACE FUNCTION public.buscar_sync_health(p_job TEXT DEFAULT NULL)
RETURNS TABLE (
  sync_id UUID,
  job_name TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT,
  health_status TEXT,
  health_reason TEXT,
  health_rank INTEGER,
  minutes_since_last_event INTEGER,
  runtime_minutes INTEGER,
  warning_after_minutes INTEGER,
  critical_after_minutes INTEGER,
  notas_lidas INTEGER,
  notas_inseridas INTEGER,
  notas_atualizadas INTEGER,
  notas_distribuidas INTEGER,
  source_total_rows INTEGER,
  source_rows_read INTEGER,
  processing_duration_ms BIGINT,
  internal_error_count INTEGER,
  internal_error_keys TEXT[],
  erro_mensagem TEXT,
  databricks_job_id TEXT,
  metadata JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.sync_id,
    v.job_name,
    v.started_at,
    v.finished_at,
    v.status,
    v.health_status,
    v.health_reason,
    v.health_rank,
    v.minutes_since_last_event,
    v.runtime_minutes,
    v.warning_after_minutes,
    v.critical_after_minutes,
    v.notas_lidas,
    v.notas_inseridas,
    v.notas_atualizadas,
    v.notas_distribuidas,
    v.source_total_rows,
    v.source_rows_read,
    v.processing_duration_ms,
    v.internal_error_count,
    v.internal_error_keys,
    v.erro_mensagem,
    v.databricks_job_id,
    v.metadata
  FROM public.vw_sync_health v
  WHERE p_job IS NULL OR v.job_name = LOWER(BTRIM(p_job))
  ORDER BY v.health_rank DESC, v.started_at DESC;
$$;

COMMENT ON FUNCTION public.buscar_sync_health(TEXT) IS
  'Retorna o diagnostico de saude do ultimo sync por job. Use p_job=''fast'' para o alerta principal do cockpit.';

GRANT SELECT ON public.vw_sync_health TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_sync_health(TEXT) TO authenticated;
