-- 00057_pmpl_owner_realign_and_summary_roles.sql
-- Corrige carteira PMPL quando o responsável configurado é gestor (ex: Gustavo):
-- 1) incluir gestores no resumo por colaborador (cards do workspace)
-- 2) criar RPC para realinhar ordens PMPL standalone para o responsável configurado
-- 3) executar realinhamento uma vez na aplicação da migration

-- ============================================================
-- 1) RESUMO DE COLABORADORES (inclui role gestor)
-- ============================================================
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
    WHERE status_ordem IN ('aberta', 'em_tratativa', 'desconhecido')
  ),
  admins AS (
    SELECT a.id, a.nome, a.avatar_url
    FROM public.administradores a
    WHERE a.ativo = true
      AND a.role IN ('admin', 'gestor')
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

COMMENT ON FUNCTION public.calcular_resumo_colaboradores_ordens(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
) IS
  'Resumo de carteira por colaborador (admin + gestor ativo), com suporte a filtro PMPL/PMOS.';

-- ============================================================
-- 2) RPC DE REALINHAMENTO PMPL STANDALONE
-- ============================================================
CREATE OR REPLACE FUNCTION public.realinhar_responsavel_pmpl_standalone()
RETURNS TABLE(
  total_candidatas INTEGER,
  reatribuicoes INTEGER,
  destino_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_responsavel UUID;
  v_substituto UUID;
  v_destino UUID;
BEGIN
  SELECT r.responsavel_id, r.substituto_id
  INTO v_responsavel, v_substituto
  FROM public.responsaveis_tipo_ordem r
  WHERE r.tipo_ordem = 'PMPL'
  LIMIT 1;

  IF v_responsavel IS NOT NULL THEN
    SELECT a.id INTO v_destino
    FROM public.administradores a
    WHERE a.id = v_responsavel
      AND a.ativo = true
      AND a.em_ferias = false
      AND (
        a.data_inicio_ferias IS NULL
        OR a.data_fim_ferias IS NULL
        OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
      );
  END IF;

  IF v_destino IS NULL AND v_substituto IS NOT NULL THEN
    SELECT a.id INTO v_destino
    FROM public.administradores a
    WHERE a.id = v_substituto
      AND a.ativo = true
      AND a.em_ferias = false
      AND (
        a.data_inicio_ferias IS NULL
        OR a.data_fim_ferias IS NULL
        OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
      );
  END IF;

  IF v_destino IS NULL THEN
    RETURN QUERY
    WITH candidatos AS (
      SELECT o.id
      FROM public.ordens_notas_acompanhamento o
      LEFT JOIN public.ordens_manutencao_referencia ref
        ON ref.ordem_codigo_norm = o.ordem_codigo
      WHERE o.nota_id IS NULL
        AND COALESCE(NULLIF(BTRIM(o.tipo_ordem), ''), NULLIF(BTRIM(ref.tipo_ordem), '')) = 'PMPL'
    )
    SELECT
      COUNT(*)::INTEGER AS total_candidatas,
      0::INTEGER AS reatribuicoes,
      NULL::UUID AS destino_id
    FROM candidatos;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT o.id
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    WHERE o.nota_id IS NULL
      AND COALESCE(NULLIF(BTRIM(o.tipo_ordem), ''), NULLIF(BTRIM(ref.tipo_ordem), '')) = 'PMPL'
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      administrador_id = v_destino,
      updated_at = now()
    WHERE o.id IN (SELECT c.id FROM candidatos c)
      AND o.administrador_id IS DISTINCT FROM v_destino
    RETURNING o.id
  )
  SELECT
    (SELECT COUNT(*) FROM candidatos)::INTEGER AS total_candidatas,
    COUNT(*)::INTEGER AS reatribuicoes,
    v_destino AS destino_id
  FROM upd;
END;
$$;

COMMENT ON FUNCTION public.realinhar_responsavel_pmpl_standalone() IS
  'Realinha ordens standalone PMPL para o responsável PMPL configurado (ou substituto elegível).';

-- ============================================================
-- 3) BACKFILL IMEDIATO
-- ============================================================
DO $$
BEGIN
  PERFORM 1 FROM public.realinhar_responsavel_pmpl_standalone();
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível executar realinhar_responsavel_pmpl_standalone no deploy: %', SQLERRM;
END;
$$;

