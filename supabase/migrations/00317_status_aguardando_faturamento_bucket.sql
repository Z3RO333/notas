-- 00317_status_aguardando_faturamento_bucket.sql
--
-- Separa AGUARDANDO_FATURAMENTO_NF do bucket 'concluida' num bucket proprio
-- 'aguardando_faturamento', para o filtro do painel de Ordens distinguir
-- "aguardando faturamento" de "concluida". Continua classificado como
-- status_raw_eh_final (nao conta como atrasada, nao entra no total ativo).
--
-- Funcoes atualizadas (apenas as versoes atualmente em uso, verificadas via
-- grep antes desta migration):
-- - classificar_status_ordem_raw / status_raw_eh_final (definidas na 00113,
--   nunca redefinidas depois — compartilhadas por toda a stack de ordens)
-- - filtrar_ordens_workspace (versao dynamic SQL da 00266 — usada por
--   buscar_ordens_workspace e pelos highlights de atencao/atrasadas)
-- - filtrar_ordens_workspace_core (versao da 00297 — usada por
--   calcular_kpis_ordens_operacional e calcular_resumo_colaboradores_ordens)

CREATE OR REPLACE FUNCTION public.classificar_status_ordem_raw(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(BTRIM(COALESCE(p_raw, '')))
    WHEN 'ABERTO' THEN 'em_aberto'
    WHEN 'ABERTA' THEN 'em_aberto'
    WHEN 'EM_PROCESSAMENTO' THEN 'em_aberto'

    WHEN 'EM_EXECUCAO' THEN 'em_execucao'
    WHEN 'EQUIPAMENTO_EM_CONSERTO' THEN 'em_execucao'
    WHEN 'ENVIAR_EMAIL_PFORNECEDOR' THEN 'em_execucao'
    WHEN 'EXECUCAO_INSATISFATORIO' THEN 'em_execucao'

    WHEN 'AVALIACAO_DA_EXECUCAO' THEN 'em_avaliacao'
    WHEN 'AVALIACAO_DE_EXECUCAO' THEN 'em_avaliacao'

    WHEN 'EXECUCAO_SATISFATORIO' THEN 'avaliada'
    WHEN 'EXECUCAO_SATISFATORIA' THEN 'avaliada'

    WHEN 'EXECUCAO_NAO_REALIZADA' THEN 'nao_realizada'

    WHEN 'AGUARDANDO_FATURAMENTO_NF' THEN 'aguardando_faturamento'

    WHEN 'CONCLUIDO' THEN 'concluida'
    WHEN 'CONCLUIDA' THEN 'concluida'

    WHEN 'CANCELADO' THEN 'cancelada'
    WHEN 'CANCELADA' THEN 'cancelada'

    ELSE 'desconhecido'
  END;
$$;

CREATE OR REPLACE FUNCTION public.status_raw_eh_final(p_raw TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.classificar_status_ordem_raw(p_raw) IN ('avaliada', 'concluida', 'cancelada', 'aguardando_faturamento');
$$;

-- ============================================================
-- filtrar_ordens_workspace (00266): adiciona branch de status
-- ============================================================
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
    ELSIF p_status = 'aguardando_faturamento' THEN
      v_sql := v_sql || ' AND UPPER(TRIM(COALESCE(v.status_ordem_raw, ''''))) = ''AGUARDANDO_FATURAMENTO_NF''';
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

-- ============================================================
-- filtrar_ordens_workspace_core (00297): adiciona branch de status
-- ============================================================
CREATE OR REPLACE FUNCTION public.filtrar_ordens_workspace_core(
  p_period_mode text DEFAULT 'all'::text,
  p_year integer DEFAULT NULL::integer,
  p_month integer DEFAULT NULL::integer,
  p_start_iso timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_exclusive_iso timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT NULL::text,
  p_unidade text DEFAULT NULL::text,
  p_responsavel text DEFAULT NULL::text,
  p_prioridade text DEFAULT NULL::text,
  p_q text DEFAULT NULL::text,
  p_admin_scope uuid DEFAULT NULL::uuid,
  p_tipo_ordem text DEFAULT NULL::text
)
RETURNS TABLE(
  ordem_id uuid, nota_id uuid, numero_nota text, ordem_codigo text,
  responsavel_atual_id uuid, unidade text, status_ordem ordem_status_acomp,
  status_ordem_raw text, ordem_detectada_em timestamp with time zone,
  dias_para_gerar_ordem integer, semaforo_atraso text, raw_bucket text,
  tipo_ordem text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
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
      v.responsavel_atual_id,
      v.unidade,
      v.status_ordem,
      v.status_ordem_raw,
      v.ordem_detectada_em,
      v.dias_para_gerar_ordem,
      v.semaforo_atraso,
      public.classificar_status_ordem_raw(v.status_ordem_raw) AS raw_bucket,
      v.tipo_ordem,
      v.descricao
    FROM public.vw_ordens_notas_painel v
  )
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
    b.semaforo_atraso,
    b.raw_bucket,
    b.tipo_ordem
  FROM base b
  CROSS JOIN params p
  WHERE
    NOT (
      b.responsavel_atual_id IS NULL
      AND UPPER(BTRIM(COALESCE(b.unidade, ''))) = 'CD PORTO VELHO'
    )
    AND (p.admin_scope IS NULL OR b.responsavel_atual_id = p.admin_scope)
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
      OR p.status_filter = 'todas'
      OR (p.status_filter = 'ativas' AND b.raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido'))
      OR (p.status_filter = 'aberta' AND b.raw_bucket = 'em_aberto')
      OR (p.status_filter = 'em_tratativa' AND b.raw_bucket = 'em_execucao')
      OR (p.status_filter = 'em_avaliacao' AND b.raw_bucket = 'em_avaliacao')
      OR (p.status_filter = 'avaliadas' AND b.raw_bucket = 'avaliada')
      OR (p.status_filter = 'nao_realizada' AND b.raw_bucket = 'nao_realizada')
      OR (p.status_filter = 'aguardando_faturamento' AND b.raw_bucket = 'aguardando_faturamento')
      OR (p.status_filter = 'concluida' AND b.raw_bucket = 'concluida')
      OR (p.status_filter = 'cancelada' AND b.raw_bucket = 'cancelada')
      OR (p.status_filter = 'desconhecido' AND b.raw_bucket = 'desconhecido')
      OR (
        p.status_filter NOT IN (
          'ativas',
          'aberta',
          'em_tratativa',
          'em_avaliacao',
          'avaliadas',
          'nao_realizada',
          'aguardando_faturamento',
          'concluida',
          'cancelada',
          'desconhecido'
        )
        AND UPPER(BTRIM(COALESCE(b.status_ordem_raw, ''))) = UPPER(BTRIM(p.status_filter))
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

-- ============================================================
-- calcular_kpis_ordens_operacional (00208): expõe a contagem do
-- novo bucket no json de KPIs, para não "sumir" da soma que antes
-- estava dentro de 'concluidas'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_kpis_ordens_operacional(
  p_period_mode TEXT DEFAULT 'all',
  p_year        INTEGER DEFAULT NULL,
  p_month       INTEGER DEFAULT NULL,
  p_start_iso        TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso TIMESTAMPTZ DEFAULT NULL,
  p_status      TEXT DEFAULT NULL,
  p_unidade     TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prioridade  TEXT DEFAULT NULL,
  p_q           TEXT DEFAULT NULL,
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  WITH filtered AS (
    SELECT *
    FROM public.filtrar_ordens_workspace_core(
      p_period_mode        => p_period_mode,
      p_year               => p_year,
      p_month              => p_month,
      p_start_iso          => p_start_iso,
      p_end_exclusive_iso  => p_end_exclusive_iso,
      p_status             => p_status,
      p_unidade            => p_unidade,
      p_responsavel        => p_responsavel,
      p_prioridade         => p_prioridade,
      p_q                  => p_q,
      p_admin_scope        => p_admin_scope,
      p_tipo_ordem         => p_tipo_ordem
    )
  )
  SELECT json_build_object(
    'total',          COUNT(*)::INTEGER,
    'abertas',        COUNT(*) FILTER (WHERE raw_bucket = 'em_aberto')::INTEGER,
    'em_tratativa',   COUNT(*) FILTER (WHERE raw_bucket IN ('em_execucao', 'nao_realizada'))::INTEGER,
    'em_avaliacao',   COUNT(*) FILTER (WHERE raw_bucket = 'em_avaliacao')::INTEGER,
    'concluidas',     COUNT(*) FILTER (WHERE raw_bucket = 'concluida')::INTEGER,
    'canceladas',     COUNT(*) FILTER (WHERE raw_bucket = 'cancelada')::INTEGER,
    'avaliadas',      COUNT(*) FILTER (WHERE raw_bucket = 'avaliada')::INTEGER,
    'aguardando_faturamento', COUNT(*) FILTER (WHERE raw_bucket = 'aguardando_faturamento')::INTEGER,
    'atrasadas',      COUNT(*) FILTER (
      WHERE semaforo_atraso = 'vermelho'
        AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER,
    'sem_responsavel', COUNT(*) FILTER (
      WHERE responsavel_atual_id IS NULL
        AND raw_bucket IN ('em_aberto', 'em_execucao', 'em_avaliacao', 'nao_realizada', 'desconhecido')
    )::INTEGER
  )
  FROM filtered;
$function$;
