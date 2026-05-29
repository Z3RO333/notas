-- Migration 00266: refactor filtrar_ordens_workspace to PL/pgSQL with dynamic SQL.
--
-- Motivação: a versão LANGUAGE sql STABLE deveria inlinear, mas as cadeias OR
-- de filtros opcionais (status com 7 branches, responsavel com 5 branches, etc.)
-- excedem a heurística de inline do planner. Resultado: Function Scan que
-- processa a view inteira em memória, gerando 2.5M shared buffer hits para
-- retornar 40 linhas — vs 13K buffers quando o WHERE é aplicado diretamente
-- na view.
--
-- Medições (produção, período jan-mai 2026, gestor view global, PMOS):
--   - Antes (LANGUAGE sql): 5901ms / 2.5M buffers
--   - Direct SELECT na view: 1375ms / 13K buffers
--
-- Estratégia: PL/pgSQL com EXECUTE USING. Construímos a string SQL anexando
-- apenas os filtros realmente ativos. Cada parâmetro é passado via USING (zero
-- risco de SQL injection). O planner enxerga um SELECT enxuto e consegue
-- pushdown dos predicatos sargable (período, responsavel, unidade) até o índice.
--
-- Semântica preservada: cada branch dos OR-chains foi mantido idêntico. Tabela
-- de mapeamento:
--   p_period_mode: 'all' | 'year' | 'year_month' | 'month' | 'range'
--   p_status:     'todas' | 'ativas' | 'em_avaliacao' | 'avaliadas' |
--                 'nao_realizada' | 'em_tratativa' | <status raw específico>
--   p_responsavel: 'todos' | '__sem_atual__' | <admin uuid>
--   p_prioridade: 'todas' | 'vermelho' | 'amarelo' | 'verde' | 'neutro'
--   p_tipo_ordem: 'todas' | 'PMOS' | 'PMPL'
--   p_unidade:    'todas' | <nome unidade>
--   p_q:          <texto para ILIKE em numero_nota, ordem_codigo, descricao>
--   p_admin_scope: <uuid> (escopo de admin específico, NULL = sem filtro)
--
-- A exclusão de "CD PORTO VELHO sem responsável atual" é sempre aplicada
-- (era hardcoded na versão anterior).

CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace(
  p_period_mode      text                     DEFAULT 'all',
  p_year             integer                  DEFAULT NULL,
  p_month            integer                  DEFAULT NULL,
  p_start_iso        timestamp with time zone DEFAULT NULL,
  p_end_exclusive_iso timestamp with time zone DEFAULT NULL,
  p_status           text                     DEFAULT NULL,
  p_unidade          text                     DEFAULT NULL,
  p_responsavel      text                     DEFAULT NULL,
  p_prioridade       text                     DEFAULT NULL,
  p_q                text                     DEFAULT NULL,
  p_admin_scope      uuid                     DEFAULT NULL,
  p_tipo_ordem       text                     DEFAULT NULL
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_sql       text;
  v_params    text[] := ARRAY[]::text[]; -- placeholders documentação
  v_period_mode_eff text := COALESCE(p_period_mode, 'all');
BEGIN
  -- Base + filtro fixo: exclui "CD PORTO VELHO sem responsável atual"
  v_sql := $sql$
    SELECT v.*
    FROM public.vw_ordens_notas_painel v
    WHERE NOT (
      v.responsavel_atual_id IS NULL
      AND UPPER(BTRIM(COALESCE(v.unidade, ''))) = 'CD PORTO VELHO'
    )
  $sql$;

  -- Filtro: admin_scope (uuid)
  IF p_admin_scope IS NOT NULL THEN
    v_sql := v_sql || ' AND v.responsavel_atual_id = $1';
  END IF;

  -- Filtro: período (sargable quando possível)
  IF v_period_mode_eff = 'year' AND p_year IS NOT NULL THEN
    v_sql := v_sql
      || ' AND v.ordem_detectada_em >= make_timestamptz($2, 1, 1, 0, 0, 0, ''UTC'')'
      || ' AND v.ordem_detectada_em <  make_timestamptz($2 + 1, 1, 1, 0, 0, 0, ''UTC'')';
  ELSIF v_period_mode_eff = 'year_month' AND p_year IS NOT NULL AND p_month IS NOT NULL THEN
    v_sql := v_sql
      || ' AND v.ordem_detectada_em >= make_timestamptz($2, $3, 1, 0, 0, 0, ''UTC'')'
      || ' AND v.ordem_detectada_em <  make_timestamptz($2, $3, 1, 0, 0, 0, ''UTC'') + INTERVAL ''1 month''';
  ELSIF v_period_mode_eff = 'month' AND p_month IS NOT NULL THEN
    -- cross-year, não-sargable (mantém EXTRACT)
    v_sql := v_sql
      || ' AND EXTRACT(MONTH FROM v.ordem_detectada_em AT TIME ZONE ''UTC'')::INT = $3';
  ELSIF v_period_mode_eff = 'range' AND p_start_iso IS NOT NULL AND p_end_exclusive_iso IS NOT NULL THEN
    v_sql := v_sql
      || ' AND v.ordem_detectada_em >= $4'
      || ' AND v.ordem_detectada_em <  $5';
  END IF;
  -- 'all' ou parâmetros incompletos: sem filtro de período

  -- Filtro: status (cada branch da OR-chain anterior vira uma branch isolada)
  IF p_status IS NOT NULL AND p_status NOT IN ('', 'todas') THEN
    IF p_status = 'ativas' THEN
      v_sql := v_sql || ' AND v.status_ordem::TEXT NOT IN (''concluida'', ''cancelada'')';
    ELSIF p_status = 'em_avaliacao' THEN
      v_sql := v_sql || ' AND public._is_em_avaliacao(v.status_ordem_raw)';
    ELSIF p_status = 'avaliadas' THEN
      v_sql := v_sql || ' AND public._is_avaliada(v.status_ordem_raw)';
    ELSIF p_status = 'nao_realizada' THEN
      v_sql := v_sql || ' AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''''))) = ''EXECUCAO_NAO_REALIZADA''';
    ELSIF p_status = 'em_tratativa' THEN
      v_sql := v_sql
        || ' AND v.status_ordem::TEXT = ''em_tratativa'''
        || ' AND NOT public._is_em_avaliacao(v.status_ordem_raw)'
        || ' AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''''))) <> ''EXECUCAO_NAO_REALIZADA''';
    ELSE
      v_sql := v_sql || ' AND v.status_ordem::TEXT = $6';
    END IF;
  END IF;

  -- Filtro: unidade
  IF p_unidade IS NOT NULL AND p_unidade NOT IN ('', 'todas') THEN
    v_sql := v_sql || ' AND v.unidade = $7';
  END IF;

  -- Filtro: responsavel
  IF p_responsavel IS NOT NULL AND p_responsavel NOT IN ('', 'todos') THEN
    IF p_responsavel = '__sem_atual__' THEN
      v_sql := v_sql || ' AND v.responsavel_atual_id IS NULL';
    ELSE
      v_sql := v_sql || ' AND v.responsavel_atual_id::TEXT = $8';
    END IF;
  END IF;

  -- Filtro: prioridade
  IF p_prioridade IS NOT NULL AND p_prioridade NOT IN ('', 'todas') THEN
    v_sql := v_sql || ' AND v.semaforo_atraso = $9';
  END IF;

  -- Filtro: q (busca textual)
  IF p_q IS NOT NULL AND p_q <> '' THEN
    v_sql := v_sql
      || ' AND ('
      || '   v.numero_nota ILIKE (''%'' || $10 || ''%'')'
      || '   OR v.ordem_codigo ILIKE (''%'' || $10 || ''%'')'
      || '   OR COALESCE(v.descricao, '''') ILIKE (''%'' || $10 || ''%'')'
      || ' )';
  END IF;

  -- Filtro: tipo_ordem
  IF p_tipo_ordem IS NOT NULL AND p_tipo_ordem NOT IN ('', 'todas') THEN
    IF p_tipo_ordem = 'PMPL' THEN
      v_sql := v_sql || ' AND v.tipo_ordem = ''PMPL''';
    ELSIF p_tipo_ordem = 'PMOS' THEN
      v_sql := v_sql || ' AND (v.tipo_ordem IS NULL OR v.tipo_ordem <> ''PMPL'')';
    END IF;
  END IF;

  RETURN QUERY EXECUTE v_sql USING
    p_admin_scope,        -- $1
    p_year,               -- $2
    p_month,              -- $3
    p_start_iso,          -- $4
    p_end_exclusive_iso,  -- $5
    p_status,             -- $6
    p_unidade,            -- $7
    p_responsavel,        -- $8
    p_prioridade,         -- $9
    p_q;                  -- $10
END;
$$;
