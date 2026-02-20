-- 00041_tipo_ordem_pmpl_pmos_tabs.sql
-- Adiciona suporte a abas PMOS / PMPL no Painel de Ordens.
--
-- Mudanças:
-- 1. Coluna tipo_ordem na tabela ordens_notas_acompanhamento
-- 2. View vw_ordens_notas_painel expõe tipo_ordem
-- 3. atualizar_status_ordens_pmpl_lote persiste tipo_ordem
-- 4. filtrar_ordens_workspace adiciona p_tipo_ordem
-- 5. buscar_ordens_workspace adiciona p_tipo_ordem e tipo_ordem no retorno
-- 6. calcular_kpis_ordens_operacional adiciona p_tipo_ordem
-- 7. calcular_resumo_colaboradores_ordens adiciona p_tipo_ordem

-- ============================================================
-- 1) COLUNA tipo_ordem NA TABELA
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS tipo_ordem TEXT;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.tipo_ordem IS
  'Tipo da ordem conforme campo TIPO_ORDEM na fonte PMPL (ex: PMPL, PMOS).';

-- ============================================================
-- 2) VIEW vw_ordens_notas_painel — inclui tipo_ordem
-- ============================================================
CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
base AS (
  SELECT
    o.id AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome AS administrador_nome,
    n.administrador_id AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
  LEFT JOIN public.administradores origem ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual ON atual.id = n.administrador_id
  LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
  LEFT JOIN historico h ON h.nota_id = o.nota_id
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
  (b.qtd_historico > 0) AS tem_historico,
  CASE
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 0
    ELSE GREATEST((current_date - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 'neutro'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id]
    ) AS x
    WHERE x IS NOT NULL
  ) AS envolvidos_admin_ids,
  b.descricao,
  b.tipo_ordem
FROM base b;

-- ============================================================
-- 3) atualizar_status_ordens_pmpl_lote — persiste tipo_ordem
-- ============================================================
CREATE OR REPLACE FUNCTION public.atualizar_status_ordens_pmpl_lote(
  p_updates JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, ordens_atualizadas INTEGER, mudancas_status INTEGER) AS $$
DECLARE
  v_item JSONB;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_status_raw TEXT;
  v_status_novo public.ordem_status_acomp;
  v_centro TEXT;
  v_unidade TEXT;
  v_data_entrada_raw TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem TEXT;
  v_total INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_mudancas INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');

    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo := public.normalizar_status_ordem(v_status_raw);
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_data_entrada_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    v_tipo_ordem := NULLIF(BTRIM(v_item ->> 'tipo_ordem'), '');

    IF v_data_entrada_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_entrada_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET
      status_ordem = v_status_novo,
      status_ordem_raw = COALESCE(v_status_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(v_centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
      data_entrada = CASE
        WHEN v_data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN v_data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, v_data_entrada)
      END,
      tipo_ordem = COALESCE(v_tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now()
    WHERE id = v_ordem.id;

    v_atualizadas := v_atualizadas + 1;

    IF v_ordem.status_ordem IS DISTINCT FROM v_status_novo THEN
      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        v_ordem.status_ordem,
        v_status_novo,
        v_status_raw,
        'pmpl_sync',
        p_sync_id
      );

      v_mudancas := v_mudancas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_atualizadas, v_mudancas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4) filtrar_ordens_workspace — adiciona p_tipo_ordem
-- ============================================================
-- DROP necessário porque o tipo de retorno (SETOF vw_ordens_notas_painel)
-- mudou ao adicionar a coluna tipo_ordem à view.
DROP FUNCTION IF EXISTS public.filtrar_ordens_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID
);

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
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
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
    )
    -- Filtro por tipo de ordem (PMPL / PMOS)
    -- PMOS inclui ordens com tipo_ordem NULL ou qualquer valor != 'PMPL'
    AND (
      p_tipo_ordem IS NULL
      OR p_tipo_ordem = ''
      OR p_tipo_ordem = 'todas'
      OR (p_tipo_ordem = 'PMPL' AND v.tipo_ordem = 'PMPL')
      OR (p_tipo_ordem = 'PMOS' AND (v.tipo_ordem IS NULL OR v.tipo_ordem <> 'PMPL'))
    );
$$;

-- ============================================================
-- 5) buscar_ordens_workspace — adiciona p_tipo_ordem e tipo_ordem no retorno
-- ============================================================
DROP FUNCTION IF EXISTS public.buscar_ordens_workspace(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
  TIMESTAMPTZ, UUID, INTEGER
);

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
  p_limit INTEGER DEFAULT 100,
  p_tipo_ordem TEXT DEFAULT NULL
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
  descricao TEXT,
  tipo_ordem TEXT
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
      p_admin_scope => p_admin_scope,
      p_tipo_ordem => p_tipo_ordem
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
    b.descricao,
    b.tipo_ordem
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
-- 6) calcular_kpis_ordens_operacional — adiciona p_tipo_ordem
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
  p_admin_scope UUID DEFAULT NULL,
  p_tipo_ordem TEXT DEFAULT NULL
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
      p_admin_scope => p_admin_scope,
      p_tipo_ordem => p_tipo_ordem
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

-- ============================================================
-- 7) calcular_resumo_colaboradores_ordens — adiciona p_tipo_ordem
-- ============================================================
DROP FUNCTION IF EXISTS public.calcular_resumo_colaboradores_ordens(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TEXT, TEXT, UUID
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
