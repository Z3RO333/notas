-- 00213_pending_sync_pmos_includes_null_tipo.sql
--
-- Problema:
-- Ordens bootstrap recem-detectadas na nota entram em vw_ordens_notas_sync_pendente
-- com tipo_ordem NULL ate o enriquecimento oficial. O workspace, por padrao,
-- consulta a fila provisoria com p_tipo_ordem='PMOS', entao essas linhas somem
-- da aba PMOS mesmo existindo na view.
--
-- Regra:
-- - pending sync continua separado da trilha oficial
-- - para filtro da aba PMOS, tipo_ordem NULL deve ser tratado como PMOS
--   provisional, sem afetar PMPL nem KPI oficial

CREATE OR REPLACE FUNCTION public.buscar_ordens_sync_pendente_workspace(
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
  p_limit INTEGER DEFAULT 24,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_sync_pendente
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
      v.administrador_id,
      v.administrador_nome,
      v.responsavel_atual_id,
      v.responsavel_atual_nome,
      v.centro,
      v.unidade,
      v.status_ordem,
      v.status_ordem_raw,
      v.ordem_detectada_em,
      v.status_atualizado_em,
      v.dias_para_gerar_ordem,
      v.qtd_historico,
      v.tem_historico,
      v.dias_em_aberto,
      v.semaforo_atraso,
      v.envolvidos_admin_ids,
      v.descricao,
      v.tipo_ordem,
      public.classificar_status_ordem_raw(v.status_ordem_raw) AS raw_bucket
    FROM public.vw_ordens_notas_sync_pendente v
  )
  SELECT
    b.ordem_id,
    b.nota_id,
    b.numero_nota,
    b.ordem_codigo,
    b.administrador_id,
    b.administrador_nome,
    b.responsavel_atual_id,
    b.responsavel_atual_nome,
    b.centro,
    b.unidade,
    b.status_ordem,
    b.status_ordem_raw,
    b.ordem_detectada_em,
    b.status_atualizado_em,
    b.dias_para_gerar_ordem,
    b.qtd_historico,
    b.tem_historico,
    b.dias_em_aberto,
    b.semaforo_atraso,
    b.envolvidos_admin_ids,
    b.descricao,
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
      OR p.status_filter = ''
      OR p.status_filter = 'todas'
      OR (
        p.status_filter = 'ativas'
        AND b.status_ordem::TEXT NOT IN ('concluida', 'cancelada')
      )
      OR (
        p.status_filter = 'em_avaliacao'
        AND public._is_em_avaliacao(b.status_ordem_raw)
      )
      OR (
        p.status_filter = 'avaliadas'
        AND public._is_avaliada(b.status_ordem_raw)
      )
      OR (
        p.status_filter = 'nao_realizada'
        AND UPPER(TRIM(COALESCE(b.status_ordem_raw, ''))) = 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p.status_filter = 'em_tratativa'
        AND b.status_ordem::TEXT = 'em_tratativa'
        AND NOT public._is_em_avaliacao(b.status_ordem_raw)
        AND UPPER(TRIM(COALESCE(b.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p.status_filter NOT IN ('ativas', 'em_avaliacao', 'avaliadas', 'nao_realizada', 'em_tratativa')
        AND b.status_ordem::TEXT = p.status_filter
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
      OR (
        p.tipo_ordem_filter = 'PMOS'
        AND COALESCE(NULLIF(BTRIM(b.tipo_ordem), ''), 'PMOS') = 'PMOS'
      )
    )
  ORDER BY b.ordem_detectada_em DESC, b.ordem_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
$function$;

COMMENT ON FUNCTION public.buscar_ordens_sync_pendente_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT
) IS
  'Lista bootstrap de ordens aguardando confirmacao do sync para exibicao no workspace, tratando tipo_ordem NULL como PMOS apenas no filtro da aba provisoria.';
