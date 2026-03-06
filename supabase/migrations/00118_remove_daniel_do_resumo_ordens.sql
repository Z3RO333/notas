-- 00118_remove_daniel_do_resumo_ordens.sql
--
-- Problema:
--   Daniel Damasceno (gestor) aparecia no painel de ordens quando tinha ordens
--   ativas atribuídas a ele. A função calcular_resumo_colaboradores_ordens
--   possui uma whitelist de gestores excepcionais que inclui Daniel.
--   Usuário confirmou: Daniel não deve aparecer no painel de ordens.
--
-- Correção:
--   Remove danieldamasceno@bemol.com.br da whitelist de gestores visíveis.
--   Walter Rodrigues permanece (gestor que gerencia ordens não-PMPL).
--   Gustavo Andrade permanece (responsável PMPL).

CREATE OR REPLACE FUNCTION public.calcular_resumo_colaboradores_ordens(
  p_period_mode        TEXT    DEFAULT 'all',
  p_year               INTEGER DEFAULT NULL,
  p_month              INTEGER DEFAULT NULL,
  p_start_iso          TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso  TIMESTAMPTZ DEFAULT NULL,
  p_status             TEXT    DEFAULT NULL,
  p_unidade            TEXT    DEFAULT NULL,
  p_responsavel        TEXT    DEFAULT NULL,
  p_prioridade         TEXT    DEFAULT NULL,
  p_q                  TEXT    DEFAULT NULL,
  p_admin_scope        UUID    DEFAULT NULL,
  p_tipo_ordem         TEXT    DEFAULT NULL
)
RETURNS TABLE(
  administrador_id UUID,
  nome             TEXT,
  avatar_url       TEXT,
  total            INTEGER,
  abertas          INTEGER,
  recentes         INTEGER,
  atencao          INTEGER,
  atrasadas        INTEGER
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT
      f.*,
      public.classificar_status_ordem_raw(f.status_ordem_raw) AS raw_bucket
    FROM public.filtrar_ordens_workspace(
      p_period_mode      => p_period_mode,
      p_year             => p_year,
      p_month            => p_month,
      p_start_iso        => p_start_iso,
      p_end_exclusive_iso => p_end_exclusive_iso,
      p_status           => p_status,
      p_unidade          => p_unidade,
      p_responsavel      => p_responsavel,
      p_prioridade       => p_prioridade,
      p_q                => p_q,
      p_admin_scope      => p_admin_scope,
      p_tipo_ordem       => p_tipo_ordem
    ) f
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
      COUNT(*) FILTER (WHERE f.raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(*) FILTER (
        WHERE f.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND f.semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(*) FILTER (
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
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
      )::INTEGER AS total,
      COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER AS abertas,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'verde'
      )::INTEGER AS recentes,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'amarelo'
      )::INTEGER AS atencao,
      COUNT(*) FILTER (
        WHERE raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
          AND semaforo_atraso = 'vermelho'
      )::INTEGER AS atrasadas
    FROM filtered
    WHERE responsavel_atual_id IS NULL
      AND p_admin_scope IS NULL
  )
  SELECT * FROM por_admin
  UNION ALL
  SELECT * FROM sem_responsavel WHERE total > 0
  ORDER BY total DESC, nome ASC;
$function$;

COMMENT ON FUNCTION public.calcular_resumo_colaboradores_ordens IS
  'Resumo de ordens por colaborador para o painel de ordens. '
  'Gestores excepcionais visíveis: Gustavo Andrade (PMPL), Walter Rodrigues (não-PMPL). '
  'Fix 00118: removido Daniel Damasceno da whitelist — gestor sem visibilidade no painel.';
