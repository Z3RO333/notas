-- 00083_fix_filtrar_ordens_workspace_pmos_null.sql
-- Corrige filtro PMOS em filtrar_ordens_workspace.
--
-- BUG: a condição anterior era:
--   (p_tipo_ordem='PMOS' AND (v.tipo_ordem IS NULL OR v.tipo_ordem<>'PMPL'))
-- Isso incluía as 5.450 ordens com tipo_ordem=NULL (bootstrap de 2026-02-26)
-- no painel PMOS, inflando o total de ~6.2k para ~11.7k.
--
-- FIX: usar correspondência exata v.tipo_ordem='PMOS'.
-- As ordens NULL ficam excluídas de ambos os painéis (PMOS e PMPL),
-- o que é correto pois são órfãs de notas já concluídas sem enriquecimento.

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace(
  p_period_mode          text    DEFAULT 'all',
  p_year                 integer DEFAULT NULL,
  p_month                integer DEFAULT NULL,
  p_start_iso            timestamptz DEFAULT NULL,
  p_end_exclusive_iso    timestamptz DEFAULT NULL,
  p_status               text    DEFAULT NULL,
  p_unidade              text    DEFAULT NULL,
  p_responsavel          text    DEFAULT NULL,
  p_prioridade           text    DEFAULT NULL,
  p_q                    text    DEFAULT NULL,
  p_admin_scope          uuid    DEFAULT NULL,
  p_tipo_ordem           text    DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT v.* FROM public.vw_ordens_notas_painel v
  WHERE (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)
    AND (COALESCE(p_period_mode,'all') = 'all'
      OR (p_period_mode='year' AND p_year IS NOT NULL AND EXTRACT(YEAR FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT=p_year)
      OR (p_period_mode='year_month' AND p_year IS NOT NULL AND p_month IS NOT NULL
          AND EXTRACT(YEAR  FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT=p_year
          AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT=p_month)
      OR (p_period_mode='month' AND p_month IS NOT NULL AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE 'UTC')::INT=p_month)
      OR (p_period_mode='range' AND p_start_iso IS NOT NULL AND p_end_exclusive_iso IS NOT NULL
          AND v.ordem_detectada_em>=p_start_iso AND v.ordem_detectada_em<p_end_exclusive_iso))
    AND (p_status IS NULL OR p_status='' OR p_status='todas'
      OR (p_status='em_avaliacao' AND public._is_em_avaliacao(v.status_ordem_raw))
      OR (p_status='avaliadas' AND public._is_avaliada(v.status_ordem_raw))
      OR (p_status='nao_realizada' AND UPPER(TRIM(COALESCE(v.status_ordem_raw,'')))='EXECUCAO_NAO_REALIZADA')
      OR (p_status='em_tratativa' AND v.status_ordem::TEXT='em_tratativa'
          AND NOT public._is_em_avaliacao(v.status_ordem_raw)
          AND UPPER(TRIM(COALESCE(v.status_ordem_raw,''))) <> 'EXECUCAO_NAO_REALIZADA')
      OR (p_status NOT IN ('em_avaliacao','avaliadas','nao_realizada','em_tratativa') AND v.status_ordem::TEXT=p_status))
    AND (p_unidade IS NULL OR p_unidade='' OR p_unidade='todas' OR v.unidade=p_unidade)
    AND (p_responsavel IS NULL OR p_responsavel='' OR p_responsavel='todos'
      OR (p_responsavel='__sem_atual__' AND v.responsavel_atual_id IS NULL)
      OR (p_responsavel<>'__sem_atual__' AND v.responsavel_atual_id::TEXT=p_responsavel))
    AND (p_prioridade IS NULL OR p_prioridade='' OR p_prioridade='todas' OR v.semaforo_atraso=p_prioridade)
    AND (p_q IS NULL OR p_q='' OR v.numero_nota ILIKE('%'||p_q||'%') OR v.ordem_codigo ILIKE('%'||p_q||'%') OR COALESCE(v.descricao,'') ILIKE('%'||p_q||'%'))
    AND (p_tipo_ordem IS NULL OR p_tipo_ordem='' OR p_tipo_ordem='todas'
      OR (p_tipo_ordem='PMPL' AND v.tipo_ordem='PMPL')
      OR (p_tipo_ordem='PMOS' AND v.tipo_ordem='PMOS'));
$function$;
