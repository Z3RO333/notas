-- 00211_orders_workspace_pending_sync_section.sql
--
-- Exibe ordens bootstrap detectadas pela nota antes da confirmacao oficial
-- do sync operacional/financeiro, sem contaminar a trilha canonica de KPIs.
--
-- Regras:
-- - ordens oficiais continuam vindo de vw_ordens_notas_painel
-- - bootstrap pendente permanece com data_entrada NULL
-- - workspace pode listar esses itens em uma secao separada
--   "Aguardando confirmacao do sync"

CREATE INDEX IF NOT EXISTS idx_ordens_notas_pending_sync_detectada
  ON public.ordens_notas_acompanhamento (tipo_ordem, ordem_detectada_em DESC, id DESC)
  WHERE data_entrada IS NULL
    AND nota_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_notas_historico_detectada_na_nota
  ON public.ordens_notas_historico (ordem_id)
  WHERE origem = 'detectada_na_nota';

CREATE OR REPLACE VIEW public.vw_ordens_notas_sync_pendente AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
bootstrap AS (
  SELECT DISTINCT
    h.ordem_id
  FROM public.ordens_notas_historico h
  WHERE h.origem = 'detectada_na_nota'
),
base AS (
  SELECT
    o.id AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome AS administrador_nome,
    CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    public.normalizar_status_ordem(o.status_ordem_raw) AS status_ordem,
    o.status_ordem_raw,
    COALESCE(o.ordem_detectada_em, o.created_at) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  JOIN bootstrap b
    ON b.ordem_id = o.id
  LEFT JOIN public.notas_manutencao n
    ON n.id = o.nota_id
  LEFT JOIN public.administradores origem
    ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual
    ON atual.id = CASE
      WHEN o.tipo_ordem = 'PMPL' THEN o.administrador_id
      ELSE COALESCE(n.administrador_id, o.administrador_id)
    END
  LEFT JOIN public.dim_centro_unidade d
    ON d.centro = o.centro
  LEFT JOIN historico h
    ON h.nota_id = o.nota_id
  WHERE o.data_entrada IS NULL
    AND o.nota_id IS NOT NULL
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
  (b.qtd_historico > 0) AS tem_historico,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 0
    ELSE GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 'neutro'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((CURRENT_DATE - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id]
    ) AS x
    WHERE x IS NOT NULL
  ) AS envolvidos_admin_ids,
  b.descricao,
  b.tipo_ordem
FROM base b;

COMMENT ON VIEW public.vw_ordens_notas_sync_pendente IS
  'Ordens bootstrap detectadas na nota e ainda sem confirmacao oficial de data_entrada. Serve apenas para UX operacional, nao para KPI oficial.';

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
      OR (p.tipo_ordem_filter = 'PMOS' AND b.tipo_ordem = 'PMOS')
    )
  ORDER BY b.ordem_detectada_em DESC, b.ordem_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
$function$;

COMMENT ON FUNCTION public.buscar_ordens_sync_pendente_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT
) IS
  'Lista bootstrap de ordens aguardando confirmacao do sync para exibicao no workspace, sem alterar KPI oficial.';

GRANT SELECT ON TABLE public.vw_ordens_notas_sync_pendente TO authenticated;
GRANT SELECT ON TABLE public.vw_ordens_notas_sync_pendente TO service_role;

GRANT EXECUTE ON FUNCTION public.buscar_ordens_sync_pendente_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.buscar_ordens_sync_pendente_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER, TEXT
) TO service_role;
