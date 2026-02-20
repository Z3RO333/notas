-- 00039_fix_status_satisfatoria_variant.sql
-- Corrige KPIs "Em avaliação" e "Avaliadas" que retornavam 0.
--
-- Causa raiz: a fonte PMPL pode gravar "EXECUCAO_SATISFATORIA" (feminino)
-- em vez de "EXECUCAO_SATISFATORIO" (masculino), ou "AVALIACAO_DE_EXECUCAO"
-- em vez de "AVALIACAO_DA_EXECUCAO". O código comparava apenas o valor
-- canônico, descartando registros com a variante.
--
-- Estratégia: todos os comparadores passam a usar IN (valor_canônico, variante).

-- ============================================================
-- 1) NORMALIZADOR DE STATUS (base de tudo)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalizar_status_ordem(p_raw TEXT)
RETURNS public.ordem_status_acomp AS $$
DECLARE
  v_raw TEXT := UPPER(BTRIM(COALESCE(p_raw, '')));
BEGIN
  IF v_raw = '' THEN
    RETURN 'desconhecido';
  END IF;

  IF v_raw IN ('ABERTO') THEN
    RETURN 'aberta';
  END IF;

  IF v_raw IN (
    'EM_PROCESSAMENTO',
    'EM_EXECUCAO',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO',      -- variante sem "DA"
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR'
  ) THEN
    RETURN 'em_tratativa';
  END IF;

  IF v_raw IN (
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA'       -- variante feminina
  ) THEN
    RETURN 'concluida';
  END IF;

  IF v_raw = 'CANCELADO' THEN
    RETURN 'cancelada';
  END IF;

  RETURN 'desconhecido';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 2) HELPER INLINE: retorna TRUE se raw é "em avaliação"
-- ============================================================
-- (mantém compatibilidade com filtrar_ordens_workspace e KPI calc)
-- Valores aceitos: AVALIACAO_DA_EXECUCAO | AVALIACAO_DE_EXECUCAO
CREATE OR REPLACE FUNCTION public._is_em_avaliacao(p_raw TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN UPPER(TRIM(COALESCE(p_raw, ''))) IN (
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 3) HELPER INLINE: retorna TRUE se raw é "avaliada/satisfatória"
-- ============================================================
CREATE OR REPLACE FUNCTION public._is_avaliada(p_raw TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN UPPER(TRIM(COALESCE(p_raw, ''))) IN (
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 4) FILTRO OPERACIONAL — atualizado com helpers
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
    (p_admin_scope IS NULL OR v.responsavel_atual_id = p_admin_scope)
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
    AND (
      p_status IS NULL
      OR p_status = ''
      OR p_status = 'todas'
      OR (
        p_status = 'em_avaliacao'
        AND public._is_em_avaliacao(v.status_ordem_raw)
      )
      OR (
        p_status = 'avaliadas'
        AND public._is_avaliada(v.status_ordem_raw)
      )
      OR (
        p_status = 'nao_realizada'
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) = 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p_status = 'em_tratativa'
        AND v.status_ordem::TEXT = 'em_tratativa'
        AND NOT public._is_em_avaliacao(v.status_ordem_raw)
        AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
      )
      OR (
        p_status NOT IN ('em_avaliacao', 'avaliadas', 'nao_realizada', 'em_tratativa')
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
-- 5) KPIs OPERACIONAIS — conta ambas as variantes
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
    'total', COUNT(DISTINCT ordem_id)::INTEGER,
    'abertas', COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'aberta')::INTEGER,
    'em_tratativa', COUNT(DISTINCT ordem_id) FILTER (
      WHERE status_ordem IN ('em_tratativa', 'desconhecido')
        AND NOT public._is_em_avaliacao(status_ordem_raw)
        AND UPPER(TRIM(COALESCE(status_ordem_raw, ''))) <> 'EXECUCAO_NAO_REALIZADA'
    )::INTEGER,
    'em_avaliacao', COUNT(DISTINCT ordem_id) FILTER (
      WHERE public._is_em_avaliacao(status_ordem_raw)
    )::INTEGER,
    'concluidas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE status_ordem = 'concluida'
        AND NOT public._is_avaliada(status_ordem_raw)
    )::INTEGER,
    'canceladas', COUNT(DISTINCT ordem_id) FILTER (WHERE status_ordem = 'cancelada')::INTEGER,
    'avaliadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE public._is_avaliada(status_ordem_raw)
    )::INTEGER,
    'atrasadas', COUNT(DISTINCT ordem_id) FILTER (
      WHERE semaforo_atraso = 'vermelho'
        AND (
          status_ordem = 'aberta'
          OR (
            status_ordem IN ('em_tratativa', 'desconhecido')
            AND NOT public._is_avaliada(status_ordem_raw)
          )
          OR public._is_em_avaliacao(status_ordem_raw)
        )
    )::INTEGER,
    'sem_responsavel', COUNT(DISTINCT ordem_id) FILTER (WHERE responsavel_atual_id IS NULL)::INTEGER
  )
  FROM filtered;
$$;
