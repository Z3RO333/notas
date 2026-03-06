-- 00112_resumo_colaboradores_conta_todos_status.sql
-- Remove o filtro hard-coded WHERE status_ordem IN ('aberta', 'em_tratativa', 'desconhecido')
-- de calcular_resumo_colaboradores_ordens. O card deve contar o mesmo conjunto que
-- buscar_ordens_workspace retorna, respeitando apenas o p_status do usuário.
-- O filtro de "ordens ativas" deve ser feito pelo usuário via filtro de status na UI,
-- não internamente no RPC.

DROP FUNCTION IF EXISTS public.calcular_resumo_colaboradores_ordens(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
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
          )
          AND (
            (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) = 'PMPL'
              AND LOWER(a.email) = 'gustavoandrade@bemol.com.br'
            )
            OR (
              UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))) <> 'PMPL'
              AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br', 'danieldamasceno@bemol.com.br')
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
      AND p_admin_scope IS NULL
  )
  SELECT *
  FROM por_admin
  UNION ALL
  SELECT *
  FROM sem_responsavel
  WHERE total > 0
  ORDER BY total DESC, nome ASC;
$$;

COMMENT ON FUNCTION public.calcular_resumo_colaboradores_ordens IS
  'Resumo de ordens por colaborador, respeitando os mesmos filtros de buscar_ordens_workspace. '
  'O total reflete o conjunto completo retornado pela API (incluindo todos os status). '
  'Inclui exceções de gestores no card quando houver ordens no filtro: '
  'Gustavo (PMPL) e Walter/Daniel (fallback refrigeração).';
