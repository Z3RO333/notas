-- 00031_orders_workspace_kpis_owner_cards.sql
-- Ajusta KPIs do workspace operacional de ordens e resumo por colaborador.

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
  recentes INTEGER,
  atencao INTEGER,
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
      COUNT(*) FILTER (WHERE f.semaforo_atraso = 'verde')::INTEGER AS recentes,
      COUNT(*) FILTER (WHERE f.semaforo_atraso = 'amarelo')::INTEGER AS atencao,
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
      COUNT(*) FILTER (WHERE semaforo_atraso = 'verde')::INTEGER AS recentes,
      COUNT(*) FILTER (WHERE semaforo_atraso = 'amarelo')::INTEGER AS atencao,
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
    'concluidas', COUNT(*) FILTER (WHERE status_ordem = 'concluida')::INTEGER,
    'canceladas', COUNT(*) FILTER (WHERE status_ordem = 'cancelada')::INTEGER,
    'avaliadas', COUNT(*) FILTER (
      WHERE UPPER(TRIM(COALESCE(status_ordem_raw, ''))) = 'AVALIACAO_DA_EXECUCAO'
    )::INTEGER,
    'atrasadas', COUNT(*) FILTER (WHERE semaforo_atraso = 'vermelho')::INTEGER,
    'sem_responsavel', COUNT(*) FILTER (WHERE responsavel_atual_id IS NULL)::INTEGER
  )
  FROM filtered;
$$;
