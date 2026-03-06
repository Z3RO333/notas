-- 00123_orders_workspace_core_filters_and_indexes.sql
--
-- Performance baseline for the orders workspace.
-- Creates a lightweight core filter for aggregated RPCs, keeps the
-- existing list contract intact, and adds indexes for the current
-- query pattern (tipo_ordem + periodo + ordenacao).

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acomp_tipo_detectada_id
  ON public.ordens_notas_acompanhamento (tipo_ordem, ordem_detectada_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notas_manutencao_admin_id_id_not_null
  ON public.notas_manutencao (administrador_id, id)
  WHERE administrador_id IS NOT NULL;

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
      o.id AS ordem_id,
      o.nota_id,
      o.numero_nota,
      o.ordem_codigo,
      n.administrador_id AS responsavel_atual_id,
      COALESCE(o.unidade, d.unidade) AS unidade,
      o.status_ordem,
      o.status_ordem_raw,
      COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
      o.dias_para_gerar_ordem,
      o.tipo_ordem,
      n.descricao
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.notas_manutencao n
      ON n.id = o.nota_id
    LEFT JOIN public.dim_centro_unidade d
      ON d.centro = o.centro
  ),
  enriched AS (
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
      CASE
        WHEN public.status_raw_eh_final(b.status_ordem_raw) THEN 'neutro'
        WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
        WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
        ELSE 'verde'
      END AS semaforo_atraso,
      public.classificar_status_ordem_raw(b.status_ordem_raw) AS raw_bucket,
      b.tipo_ordem,
      b.descricao
    FROM base b
  )
  SELECT
    e.ordem_id,
    e.nota_id,
    e.numero_nota,
    e.ordem_codigo,
    e.responsavel_atual_id,
    e.unidade,
    e.status_ordem,
    e.status_ordem_raw,
    e.ordem_detectada_em,
    e.dias_para_gerar_ordem,
    e.semaforo_atraso,
    e.raw_bucket,
    e.tipo_ordem
  FROM enriched e
  CROSS JOIN params p
  WHERE
    (p.admin_scope IS NULL OR e.responsavel_atual_id = p.admin_scope)
    AND (
      p.period_mode = 'all'
      OR (
        p.period_mode = 'year'
        AND p.year_start_iso IS NOT NULL
        AND e.ordem_detectada_em >= p.year_start_iso
        AND e.ordem_detectada_em < p.year_end_exclusive_iso
      )
      OR (
        p.period_mode = 'year_month'
        AND p.year_month_start_iso IS NOT NULL
        AND e.ordem_detectada_em >= p.year_month_start_iso
        AND e.ordem_detectada_em < p.year_month_end_exclusive_iso
      )
      OR (
        p.period_mode = 'month'
        AND p.month_filter IS NOT NULL
        AND EXTRACT(MONTH FROM e.ordem_detectada_em AT TIME ZONE 'UTC')::INT = p.month_filter
      )
      OR (
        p.period_mode = 'range'
        AND p.start_iso IS NOT NULL
        AND p.end_exclusive_iso IS NOT NULL
        AND e.ordem_detectada_em >= p.start_iso
        AND e.ordem_detectada_em < p.end_exclusive_iso
      )
    )
    AND (
      p.status_filter IS NULL
      OR p.status_filter = 'todas'
      OR (p.status_filter = 'aberta' AND e.raw_bucket = 'em_aberto')
      OR (p.status_filter = 'em_tratativa' AND e.raw_bucket = 'em_execucao')
      OR (p.status_filter = 'em_avaliacao' AND e.raw_bucket = 'em_avaliacao')
      OR (p.status_filter = 'avaliadas' AND e.raw_bucket = 'avaliada')
      OR (p.status_filter = 'nao_realizada' AND e.raw_bucket = 'nao_realizada')
      OR (p.status_filter = 'concluida' AND e.raw_bucket = 'concluida')
      OR (p.status_filter = 'cancelada' AND e.raw_bucket = 'cancelada')
      OR (p.status_filter = 'desconhecido' AND e.raw_bucket = 'desconhecido')
      OR (
        p.status_filter NOT IN (
          'aberta',
          'em_tratativa',
          'em_avaliacao',
          'avaliadas',
          'nao_realizada',
          'concluida',
          'cancelada',
          'desconhecido'
        )
        AND e.status_ordem::TEXT = p.status_filter
      )
    )
    AND (
      p.unidade_filter IS NULL
      OR p.unidade_filter = 'todas'
      OR e.unidade = p.unidade_filter
    )
    AND (
      p.responsavel_filter IS NULL
      OR p.responsavel_filter = 'todos'
      OR (
        p.responsavel_filter = '__sem_atual__'
        AND e.responsavel_atual_id IS NULL
      )
      OR (
        p.responsavel_filter <> '__sem_atual__'
        AND p.responsavel_uuid IS NOT NULL
        AND e.responsavel_atual_id = p.responsavel_uuid
      )
    )
    AND (
      p.prioridade_filter IS NULL
      OR p.prioridade_filter = 'todas'
      OR e.semaforo_atraso = p.prioridade_filter
    )
    AND (
      p.q_filter IS NULL
      OR e.numero_nota ILIKE ('%' || p.q_filter || '%')
      OR e.ordem_codigo ILIKE ('%' || p.q_filter || '%')
      OR COALESCE(e.descricao, '') ILIKE ('%' || p.q_filter || '%')
    )
    AND (
      p.tipo_ordem_filter IS NULL
      OR p.tipo_ordem_filter = 'TODAS'
      OR (p.tipo_ordem_filter = 'PMPL' AND e.tipo_ordem = 'PMPL')
      OR (p.tipo_ordem_filter = 'PMOS' AND e.tipo_ordem = 'PMOS')
    );
$function$;

COMMENT ON FUNCTION public.filtrar_ordens_workspace_core(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
) IS
  'Lightweight filter core for aggregated orders workspace RPCs. '
  'Avoids vw_ordens_notas_painel heavy fields while preserving filter semantics.';

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
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
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
    FROM public.vw_ordens_notas_painel v
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
          'aberta',
          'em_tratativa',
          'em_avaliacao',
          'avaliadas',
          'nao_realizada',
          'concluida',
          'cancelada',
          'desconhecido'
        )
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
    );
$function$;

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
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
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
  )
  FROM filtered;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_resumo_colaboradores_ordens(
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
  administrador_id UUID,
  nome TEXT,
  avatar_url TEXT,
  total INTEGER,
  abertas INTEGER,
  recentes INTEGER,
  atencao INTEGER,
  atrasadas INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
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
  ),
  admins AS (
    SELECT a.id, a.nome, a.avatar_url
    FROM public.administradores a
    WHERE a.ativo = true
      AND (
        a.role = 'admin'
        OR (
          a.role = 'gestor'
          AND EXISTS (
            SELECT 1
            FROM filtered f
            WHERE f.responsavel_atual_id = a.id
              AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          )
          AND (
            (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) = 'PMPL'
              AND LOWER(a.email) = 'gustavoandrade@bemol.com.br'
            )
            OR (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) <> 'PMPL'
              AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br')
            )
          )
        )
      )
      AND (p_admin_scope IS NULL OR a.id = p_admin_scope)
  ),
  por_admin AS (
    SELECT
      a.id AS administrador_id,
      a.nome,
      a.avatar_url,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS total,
      COUNT(f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'vermelho'
      )::INTEGER AS atrasadas
    FROM admins a
    LEFT JOIN filtered f
      ON f.responsavel_atual_id = a.id
    GROUP BY a.id, a.nome, a.avatar_url
  ),
  sem_responsavel AS (
    SELECT
      NULL::UUID AS administrador_id,
      'Sem responsavel'::TEXT AS nome,
      NULL::TEXT AS avatar_url,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS total,
      COUNT(f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(f.ordem_id) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'vermelho'
      )::INTEGER AS atrasadas
    FROM filtered f
    WHERE f.responsavel_atual_id IS NULL
      AND p_admin_scope IS NULL
  )
  SELECT * FROM por_admin
  UNION ALL
  SELECT * FROM sem_responsavel WHERE total > 0
  ORDER BY total DESC, nome ASC;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_admin(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_concluidas_30d INTEGER,
  qtd_canceladas_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode => 'range',
      p_year => NULL,
      p_month => NULL,
      p_start_iso => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status => NULL,
      p_unidade => NULL,
      p_responsavel => NULL,
      p_prioridade => NULL,
      p_q => NULL,
      p_admin_scope => NULL,
      p_tipo_ordem => p_tipo_ordem
    )
  ),
  aggregated AS (
    SELECT
      f.responsavel_atual_id AS administrador_id,
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
    FROM filtered f
    WHERE f.responsavel_atual_id IS NOT NULL
    GROUP BY f.responsavel_atual_id
  )
  SELECT
    a.administrador_id,
    COALESCE(adm.nome, 'Sem nome') AS nome,
    a.qtd_ordens_30d,
    a.qtd_abertas_30d,
    a.qtd_em_tratativa_30d,
    a.qtd_concluidas_30d,
    a.qtd_canceladas_30d,
    a.qtd_antigas_7d_30d,
    a.tempo_medio_geracao_dias_30d
  FROM aggregated a
  LEFT JOIN public.administradores adm
    ON adm.id = a.administrador_id
  ORDER BY a.qtd_ordens_30d DESC, COALESCE(adm.nome, 'Sem nome') ASC;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_unidade(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  unidade TEXT,
  qtd_ordens_30d INTEGER,
  qtd_abertas_30d INTEGER,
  qtd_em_tratativa_30d INTEGER,
  qtd_antigas_7d_30d INTEGER,
  tempo_medio_geracao_dias_30d NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode => 'range',
      p_year => NULL,
      p_month => NULL,
      p_start_iso => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status => NULL,
      p_unidade => NULL,
      p_responsavel => NULL,
      p_prioridade => NULL,
      p_q => NULL,
      p_admin_scope => NULL,
      p_tipo_ordem => p_tipo_ordem
    )
  )
  SELECT
    COALESCE(f.unidade, 'Sem unidade') AS unidade,
    COUNT(DISTINCT f.ordem_id)::INTEGER AS qtd_ordens_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS qtd_abertas_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (WHERE f.raw_bucket = 'em_execucao')::INTEGER AS qtd_em_tratativa_30d,
    COUNT(DISTINCT f.ordem_id) FILTER (
      WHERE f.semaforo_atraso = 'vermelho'
        AND f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER AS qtd_antigas_7d_30d,
    ROUND(AVG(f.dias_para_gerar_ordem) FILTER (
      WHERE f.dias_para_gerar_ordem IS NOT NULL
    ), 2) AS tempo_medio_geracao_dias_30d
  FROM filtered f
  GROUP BY COALESCE(f.unidade, 'Sem unidade')
  ORDER BY qtd_ordens_30d DESC, unidade ASC;
$function$;
