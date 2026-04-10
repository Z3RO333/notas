-- 00218_fix_status_ativas_filter_in_workspace_core.sql
--
-- O filtro p_status = 'ativas' (padrão do frontend) não estava mapeado no
-- filtrar_ordens_workspace_core. Caía no branch de fallback que tentava
-- comparar status_ordem_raw = 'ATIVAS', retornando zero linhas.
--
-- Fix: adicionar 'ativas' como alias composto para todos os buckets ativos
-- (em_aberto + em_execucao + em_avaliacao + nao_realizada + desconhecido),
-- idêntico ao critério já usado nos COUNTs de calcular_resumo_colaboradores_ordens.

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace_core(
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
RETURNS TABLE(
  ordem_id UUID,
  nota_id UUID,
  numero_nota TEXT,
  ordem_codigo TEXT,
  responsavel_atual_id UUID,
  unidade TEXT,
  status_ordem public.ordem_status_acomp,
  status_ordem_raw TEXT,
  ordem_detectada_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  semaforo_atraso TEXT,
  raw_bucket TEXT,
  tipo_ordem TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH params AS (
    SELECT
      COALESCE(NULLIF(BTRIM(p_period_mode), ''), 'all') AS period_mode,
      p_year AS year_filter,
      p_month AS month_filter,
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      CASE
        WHEN p_year IS NOT NULL THEN make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC')
        ELSE NULL
      END AS year_start_iso,
      CASE
        WHEN p_year IS NOT NULL THEN make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC')
        ELSE NULL
      END AS year_end_exclusive_iso,
      CASE
        WHEN p_year IS NOT NULL AND p_month IS NOT NULL AND p_month BETWEEN 1 AND 12
          THEN make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC')
        ELSE NULL
      END AS year_month_start_iso,
      CASE
        WHEN p_year IS NOT NULL AND p_month IS NOT NULL AND p_month BETWEEN 1 AND 12
          THEN make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC') + INTERVAL '1 month'
        ELSE NULL
      END AS year_month_end_exclusive_iso,
      NULLIF(BTRIM(p_status), '') AS status_filter,
      NULLIF(BTRIM(p_unidade), '') AS unidade_filter,
      NULLIF(BTRIM(p_responsavel), '') AS responsavel_filter,
      CASE
        WHEN NULLIF(BTRIM(p_responsavel), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN NULLIF(BTRIM(p_responsavel), '')::UUID
        ELSE NULL::UUID
      END AS responsavel_uuid,
      NULLIF(BTRIM(p_prioridade), '') AS prioridade_filter,
      NULLIF(BTRIM(p_q), '') AS q_filter,
      UPPER(NULLIF(BTRIM(p_tipo_ordem), '')) AS tipo_ordem_filter,
      p_admin_scope AS admin_scope
  ),
  base AS (
    SELECT
      v.ordem_id,
      v.nota_id,
      v.numero_nota,
      v.ordem_codigo,
      v.responsavel_atual_id,
      v.unidade,
      v.status_ordem,
      v.status_ordem_raw,
      v.ordem_detectada_em,
      v.dias_para_gerar_ordem,
      v.semaforo_atraso,
      public.classificar_status_ordem_raw(v.status_ordem_raw) AS raw_bucket,
      v.tipo_ordem,
      v.descricao
    FROM public.vw_ordens_notas_painel v
  )
  SELECT
    b.ordem_id,
    b.nota_id,
    b.numero_nota,
    b.ordem_codigo,
    b.responsavel_atual_id,
    b.unidade,
    b.status_ordem,
    b.status_ordem_raw,
    b.ordem_detectada_em,
    b.dias_para_gerar_ordem,
    b.semaforo_atraso,
    b.raw_bucket,
    b.tipo_ordem
  FROM base b
  CROSS JOIN params p
  WHERE
    (p.admin_scope IS NULL OR b.responsavel_atual_id = p.admin_scope)
    AND (
      p.period_mode = 'all'
      OR (
        p.period_mode = 'year'
        AND p.year_start_iso IS NOT NULL
        AND b.ordem_detectada_em >= p.year_start_iso
        AND b.ordem_detectada_em < p.year_end_exclusive_iso
      )
      OR (
        p.period_mode = 'year_month'
        AND p.year_month_start_iso IS NOT NULL
        AND b.ordem_detectada_em >= p.year_month_start_iso
        AND b.ordem_detectada_em < p.year_month_end_exclusive_iso
      )
      OR (
        p.period_mode = 'month'
        AND p.month_filter IS NOT NULL
        AND EXTRACT(MONTH FROM b.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p.month_filter
      )
      OR (
        p.period_mode = 'range'
        AND p.start_iso IS NOT NULL
        AND p.end_exclusive_iso IS NOT NULL
        AND b.ordem_detectada_em >= p.start_iso
        AND b.ordem_detectada_em < p.end_exclusive_iso
      )
    )
    AND (
      p.status_filter IS NULL
      OR p.status_filter = 'todas'
      -- 'ativas' = alias composto para todos os buckets não-finais (padrão do frontend)
      OR (p.status_filter = 'ativas' AND b.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido'))
      OR (p.status_filter = 'aberta' AND b.raw_bucket = 'em_aberto')
      OR (p.status_filter = 'em_tratativa' AND b.raw_bucket = 'em_execucao')
      OR (p.status_filter = 'em_avaliacao' AND b.raw_bucket = 'em_avaliacao')
      OR (p.status_filter = 'avaliadas' AND b.raw_bucket = 'avaliada')
      OR (p.status_filter = 'nao_realizada' AND b.raw_bucket = 'nao_realizada')
      OR (p.status_filter = 'concluida' AND b.raw_bucket = 'concluida')
      OR (p.status_filter = 'cancelada' AND b.raw_bucket = 'cancelada')
      OR (p.status_filter = 'desconhecido' AND b.raw_bucket = 'desconhecido')
      OR (
        p.status_filter NOT IN (
          'ativas',
          'aberta',
          'em_tratativa',
          'em_avaliacao',
          'avaliadas',
          'nao_realizada',
          'concluida',
          'cancelada',
          'desconhecido'
        )
        AND UPPER(BTRIM(COALESCE(b.status_ordem_raw, ''))) = UPPER(BTRIM(p.status_filter))
      )
    )
    AND (
      p.unidade_filter IS NULL
      OR p.unidade_filter = 'todas'
      OR b.unidade = p.unidade_filter
    )
    AND (
      p.responsavel_filter IS NULL
      OR p.responsavel_filter = 'todos'
      OR (
        p.responsavel_filter = '__sem_atual__'
        AND b.responsavel_atual_id IS NULL
      )
      OR (
        p.responsavel_filter <> '__sem_atual__'
        AND p.responsavel_uuid IS NOT NULL
        AND b.responsavel_atual_id = p.responsavel_uuid
      )
    )
    AND (
      p.prioridade_filter IS NULL
      OR p.prioridade_filter = 'todas'
      OR b.semaforo_atraso = p.prioridade_filter
    )
    AND (
      p.q_filter IS NULL
      OR b.numero_nota ILIKE ('%' || p.q_filter || '%')
      OR b.ordem_codigo ILIKE ('%' || p.q_filter || '%')
      OR COALESCE(b.descricao, '') ILIKE ('%' || p.q_filter || '%')
    )
    AND (
      p.tipo_ordem_filter IS NULL
      OR p.tipo_ordem_filter = 'TODAS'
      OR (p.tipo_ordem_filter = 'PMPL' AND b.tipo_ordem = 'PMPL')
      OR (p.tipo_ordem_filter = 'PMOS' AND b.tipo_ordem = 'PMOS')
    );
$function$;
