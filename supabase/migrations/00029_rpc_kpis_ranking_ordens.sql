-- ============================================================
-- Migration 00029: RPCs para KPIs e Rankings do Painel de Ordens
-- Elimina necessidade de buscar todas as linhas no client
-- ============================================================

-- 1. KPIs agregados (substitui o loop de metricsRows no page.tsx)
CREATE OR REPLACE FUNCTION public.calcular_kpis_ordens(
  p_start_iso timestamptz,
  p_end_exclusive_iso timestamptz,
  p_admin_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_unidade text DEFAULT NULL,
  p_responsavel text DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'total', COUNT(*)::integer,
    'abertas', COUNT(*) FILTER (WHERE status_ordem = 'aberta')::integer,
    'em_tratativa', COUNT(*) FILTER (WHERE status_ordem = 'em_tratativa')::integer,
    'concluidas', COUNT(*) FILTER (WHERE status_ordem = 'concluida')::integer,
    'canceladas', COUNT(*) FILTER (WHERE status_ordem = 'cancelada')::integer,
    'avaliadas', COUNT(*) FILTER (WHERE UPPER(TRIM(status_ordem_raw)) = 'AVALIACAO_DA_EXECUCAO')::integer,
    'atrasadas_7d', COUNT(*) FILTER (WHERE semaforo_atraso = 'vermelho')::integer,
    'sem_responsavel', COUNT(*) FILTER (WHERE responsavel_atual_id IS NULL)::integer
  )
  FROM public.vw_ordens_notas_painel
  WHERE ordem_detectada_em >= p_start_iso
    AND ordem_detectada_em < p_end_exclusive_iso
    AND (p_admin_id IS NULL OR responsavel_atual_id = p_admin_id)
    AND (p_status IS NULL OR p_status = 'todas' OR
         CASE
           WHEN p_status = 'avaliadas' THEN UPPER(TRIM(status_ordem_raw)) = 'AVALIACAO_DA_EXECUCAO'
           ELSE status_ordem = p_status::public.ordem_status_acomp
         END)
    AND (p_unidade IS NULL OR p_unidade = 'todas' OR unidade = p_unidade)
    AND (p_responsavel IS NULL OR p_responsavel = 'todos' OR
         CASE
           WHEN p_responsavel = '__sem_atual__' THEN responsavel_atual_id IS NULL
           ELSE responsavel_atual_id::text = p_responsavel
         END)
$$;

-- 2. Ranking por admin (substitui buildOrderRankingAdmin)
CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_admin(
  p_start_iso timestamptz,
  p_end_exclusive_iso timestamptz
)
RETURNS TABLE(
  administrador_id uuid,
  nome text,
  qtd_ordens_30d integer,
  qtd_abertas_30d integer,
  qtd_em_tratativa_30d integer,
  qtd_concluidas_30d integer,
  qtd_canceladas_30d integer,
  qtd_antigas_7d_30d integer,
  tempo_medio_geracao_dias_30d numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    v.administrador_id,
    COALESCE(v.administrador_nome, 'Sem nome') AS nome,
    COUNT(*)::integer AS qtd_ordens_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'aberta')::integer AS qtd_abertas_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'em_tratativa')::integer AS qtd_em_tratativa_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'concluida')::integer AS qtd_concluidas_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'cancelada')::integer AS qtd_canceladas_30d,
    COUNT(*) FILTER (WHERE v.semaforo_atraso = 'vermelho')::integer AS qtd_antigas_7d_30d,
    ROUND(AVG(v.dias_para_gerar_ordem) FILTER (WHERE v.dias_para_gerar_ordem IS NOT NULL), 2) AS tempo_medio_geracao_dias_30d
  FROM public.vw_ordens_notas_painel v
  WHERE v.ordem_detectada_em >= p_start_iso
    AND v.ordem_detectada_em < p_end_exclusive_iso
    AND v.administrador_id IS NOT NULL
  GROUP BY v.administrador_id, v.administrador_nome
  ORDER BY qtd_ordens_30d DESC, nome ASC
$$;

-- 3. Ranking por unidade (substitui buildOrderRankingUnidade)
CREATE OR REPLACE FUNCTION public.calcular_ranking_ordens_unidade(
  p_start_iso timestamptz,
  p_end_exclusive_iso timestamptz
)
RETURNS TABLE(
  unidade text,
  qtd_ordens_30d integer,
  qtd_abertas_30d integer,
  qtd_em_tratativa_30d integer,
  qtd_antigas_7d_30d integer,
  tempo_medio_geracao_dias_30d numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(v.unidade, 'Sem unidade') AS unidade,
    COUNT(*)::integer AS qtd_ordens_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'aberta')::integer AS qtd_abertas_30d,
    COUNT(*) FILTER (WHERE v.status_ordem = 'em_tratativa')::integer AS qtd_em_tratativa_30d,
    COUNT(*) FILTER (WHERE v.semaforo_atraso = 'vermelho')::integer AS qtd_antigas_7d_30d,
    ROUND(AVG(v.dias_para_gerar_ordem) FILTER (WHERE v.dias_para_gerar_ordem IS NOT NULL), 2) AS tempo_medio_geracao_dias_30d
  FROM public.vw_ordens_notas_painel v
  WHERE v.ordem_detectada_em >= p_start_iso
    AND v.ordem_detectada_em < p_end_exclusive_iso
  GROUP BY COALESCE(v.unidade, 'Sem unidade')
  ORDER BY qtd_ordens_30d DESC, unidade ASC
$$;
