-- 00030_orders_workspace_operational_fast.sql
-- Workspace operacional de ordens: performance + RPCs para lista, resumo e KPIs.

-- ============================================================
-- 1) INDICES DE PERFORMANCE
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_detectada_id
  ON public.ordens_notas_acompanhamento (ordem_detectada_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_unidade_detectada
  ON public.ordens_notas_acompanhamento (unidade, ordem_detectada_em DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_ordem_codigo_trgm
  ON public.ordens_notas_acompanhamento
  USING gin (ordem_codigo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_numero_nota_trgm
  ON public.ordens_notas_acompanhamento
  USING gin (numero_nota gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_notas_manutencao_descricao_trgm
  ON public.notas_manutencao
  USING gin (descricao gin_trgm_ops);

-- ============================================================
-- 2) FUNCAO BASE: FILTRO OPERACIONAL REUTILIZAVEL
-- ============================================================
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
    -- Escopo de visibilidade (admin restrito ao proprio responsável atual)
    (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)

    -- Período
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

    -- Filtros operacionais
    AND (
      p_status IS NULL
      OR p_status = ''
      OR p_status = 'todas'
      OR (
        p_status = 'avaliadas'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
      )
      OR (
        p_status <> 'avaliadas'
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

-- ============================================================
-- 3) LISTA PAGINADA (CURSOR) PARA WORKSPACE
-- ============================================================
CREATE OR REPLACE FUNCTION public.buscar_ordens_workspace(
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
  p_cursor_detectada TIMESTAMPTZ DEFAULT NULL,
  p_cursor_ordem_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
  ordem_id UUID,
  nota_id UUID,
  numero_nota TEXT,
  ordem_codigo TEXT,
  administrador_id UUID,
  administrador_nome TEXT,
  responsavel_atual_id UUID,
  responsavel_atual_nome TEXT,
  centro TEXT,
  unidade TEXT,
  status_ordem public.ordem_status_acomp,
  status_ordem_raw TEXT,
  ordem_detectada_em TIMESTAMPTZ,
  status_atualizado_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  qtd_historico BIGINT,
  tem_historico BOOLEAN,
  dias_em_aberto INTEGER,
  semaforo_atraso TEXT,
  envolvidos_admin_ids UUID[],
  descricao TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
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
    b.semaforo_atraso::TEXT AS semaforo_atraso,
    b.envolvidos_admin_ids,
    b.descricao
  FROM base b
  WHERE
    p_cursor_detectada IS NULL
    OR (
      (b.ordem_detectada_em, b.ordem_id) <
      (p_cursor_detectada, COALESCE(p_cursor_ordem_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID))
    )
  ORDER BY b.ordem_detectada_em DESC, b.ordem_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
$$;

-- ============================================================
-- 4) RESUMO POR COLABORADOR (TOPO DO WORKSPACE)
-- ============================================================
DROP FUNCTION IF EXISTS public.calcular_resumo_colaboradores_ordens(
  TEXT,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
);

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
  p_admin_scope UUID DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  avatar_url TEXT,
  total INTEGER,
  abertas INTEGER,
  atrasadas INTEGER
)
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
    WHERE status_ordem IN ('aberta', 'em_tratativa', 'desconhecido')
  ),
  admins AS (
    SELECT a.id, a.nome, a.avatar_url
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
  ),
  por_admin AS (
    SELECT
      a.id AS administrador_id,
      a.nome,
      a.avatar_url,
      COUNT(f.ordem_id)::INTEGER AS total,
      COUNT(*) FILTER (WHERE f.status_ordem = 'aberta')::INTEGER AS abertas,
      COUNT(*) FILTER (WHERE f.semaforo_atraso = 'vermelho')::INTEGER AS atrasadas
    FROM admins a
    LEFT JOIN filtered f
      ON f.responsavel_atual_id = a.id
    GROUP BY a.id, a.nome, a.avatar_url
  ),
  sem_responsavel AS (
    SELECT
      NULL::UUID AS administrador_id,
      'Sem responsável'::TEXT AS nome,
      NULL::TEXT AS avatar_url,
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE status_ordem = 'aberta')::INTEGER AS abertas,
      COUNT(*) FILTER (WHERE semaforo_atraso = 'vermelho')::INTEGER AS atrasadas
    FROM filtered
    WHERE responsavel_atual_id IS NULL
  )
  SELECT *
  FROM por_admin
  UNION ALL
  SELECT *
  FROM sem_responsavel
  WHERE total > 0
  ORDER BY total DESC, nome ASC;
$$;

-- ============================================================
-- 5) KPIS BASICOS OPERACIONAIS
-- ============================================================
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
    'total', COUNT(*)::INTEGER,
    'abertas', COUNT(*) FILTER (WHERE status_ordem = 'aberta')::INTEGER,
    'em_tratativa', COUNT(*) FILTER (WHERE status_ordem = 'em_tratativa')::INTEGER,
    'atrasadas', COUNT(*) FILTER (WHERE semaforo_atraso = 'vermelho')::INTEGER,
    'sem_responsavel', COUNT(*) FILTER (WHERE responsavel_atual_id IS NULL)::INTEGER
  )
  FROM filtered;
$$;
