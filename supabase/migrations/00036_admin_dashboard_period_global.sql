-- 00036_admin_dashboard_period_global.sql
-- Dashboard administrativo com periodo global (notas + ordens)

CREATE INDEX IF NOT EXISTS idx_notas_manutencao_data_criacao_sap_dashboard
  ON public.notas_manutencao (data_criacao_sap)
  WHERE data_criacao_sap IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notas_historico_status_concluida_dashboard
  ON public.notas_historico (created_at DESC, nota_id)
  WHERE campo_alterado = 'status' AND valor_novo = 'concluida';

CREATE INDEX IF NOT EXISTS idx_ordens_acomp_nota_detectada_dashboard
  ON public.ordens_notas_acompanhamento (nota_id, ordem_detectada_em DESC);

ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS data_entrada TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_data_entrada_dashboard
  ON public.ordens_notas_acompanhamento (data_entrada DESC)
  WHERE data_entrada IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_data_referencia_dashboard
  ON public.ordens_notas_acompanhamento ((COALESCE(data_entrada, ordem_detectada_em)) DESC);

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
    n.descricao
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
  b.descricao
FROM base b;

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

CREATE OR REPLACE FUNCTION public.calcular_metricas_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_start_iso AT TIME ZONE 'UTC')::DATE AS start_date,
      (p_end_exclusive_iso AT TIME ZONE 'UTC')::DATE AS end_date_exclusive
  ),
  notas_base AS (
    SELECT
      n.id,
      n.status,
      n.administrador_id,
      COALESCE((n.data_criacao_sap::TIMESTAMP AT TIME ZONE 'UTC'), n.created_at) AS referencia_criacao
    FROM public.notas_manutencao n
    JOIN periodo p ON TRUE
    WHERE (
        n.data_criacao_sap IS NOT NULL
        AND n.data_criacao_sap >= p.start_date
        AND n.data_criacao_sap < p.end_date_exclusive
      )
      OR (
        n.data_criacao_sap IS NULL
        AND n.created_at >= p.start_iso
        AND n.created_at < p.end_exclusive_iso
      )
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      MIN(h.created_at) AS concluida_em
    FROM public.notas_historico h
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
    GROUP BY h.nota_id
  ),
  agg_notas AS (
    SELECT
      COUNT(*)::INTEGER AS qtd_notas_criadas_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS abertas_periodo,
      COUNT(*) FILTER (
        WHERE n.status = 'nova' AND n.administrador_id IS NULL
      )::INTEGER AS sem_atribuir_periodo,
      COUNT(*) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
          AND now() - n.referencia_criacao > INTERVAL '48 hours'
      )::INTEGER AS aging_48h_periodo
    FROM notas_base n
  ),
  agg_convertidas AS (
    SELECT
      COUNT(DISTINCT n.id)::INTEGER AS qtd_notas_convertidas_periodo
    FROM notas_base n
    JOIN public.ordens_notas_acompanhamento o
      ON o.nota_id = n.id
    JOIN periodo p ON TRUE
    WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) < p.end_exclusive_iso
  ),
  agg_concluidas AS (
    SELECT
      COUNT(*)::INTEGER AS qtd_concluidas_periodo
    FROM conclusoes_unicas c
    JOIN periodo p ON TRUE
    WHERE c.concluida_em >= p.start_iso
      AND c.concluida_em < p.end_exclusive_iso
  )
  SELECT json_build_object(
    'abertas_periodo', a.abertas_periodo,
    'sem_atribuir_periodo', a.sem_atribuir_periodo,
    'aging_48h_periodo', a.aging_48h_periodo,
    'qtd_notas_criadas_periodo', a.qtd_notas_criadas_periodo,
    'qtd_notas_convertidas_periodo', c.qtd_notas_convertidas_periodo,
    'qtd_concluidas_periodo', f.qtd_concluidas_periodo,
    'taxa_nota_ordem_periodo',
      ROUND(
        c.qtd_notas_convertidas_periodo::NUMERIC
        / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC,
        4
      ),
    'taxa_fechamento_periodo',
      ROUND(
        f.qtd_concluidas_periodo::NUMERIC
        / GREATEST(a.qtd_notas_criadas_periodo, 1)::NUMERIC,
        4
      )
  )
  FROM agg_notas a
  CROSS JOIN agg_convertidas c
  CROSS JOIN agg_concluidas f;
$$;

CREATE OR REPLACE FUNCTION public.listar_fluxo_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS TABLE(
  dia DATE,
  qtd_entradas INTEGER,
  qtd_concluidas INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_start_iso AT TIME ZONE 'UTC')::DATE AS start_date,
      (p_end_exclusive_iso AT TIME ZONE 'UTC')::DATE AS end_date_exclusive
  ),
  dias AS (
    SELECT
      generate_series(
        p.start_date,
        (p.end_date_exclusive - 1),
        INTERVAL '1 day'
      )::DATE AS dia
    FROM periodo p
  ),
  entradas AS (
    SELECT
      CASE
        WHEN n.data_criacao_sap IS NOT NULL THEN n.data_criacao_sap
        ELSE (n.created_at AT TIME ZONE 'UTC')::DATE
      END AS dia,
      COUNT(*)::INTEGER AS qtd_entradas
    FROM public.notas_manutencao n
    JOIN periodo p ON TRUE
    WHERE (
        n.data_criacao_sap IS NOT NULL
        AND n.data_criacao_sap >= p.start_date
        AND n.data_criacao_sap < p.end_date_exclusive
      )
      OR (
        n.data_criacao_sap IS NULL
        AND n.created_at >= p.start_iso
        AND n.created_at < p.end_exclusive_iso
      )
    GROUP BY 1
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      MIN(h.created_at::DATE) AS dia
    FROM public.notas_historico h
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
    GROUP BY h.nota_id
  ),
  concluidas AS (
    SELECT
      c.dia,
      COUNT(*)::INTEGER AS qtd_concluidas
    FROM conclusoes_unicas c
    JOIN periodo p ON TRUE
    WHERE c.dia >= p.start_date
      AND c.dia < p.end_date_exclusive
    GROUP BY c.dia
  )
  SELECT
    d.dia,
    COALESCE(e.qtd_entradas, 0)::INTEGER AS qtd_entradas,
    COALESCE(c.qtd_concluidas, 0)::INTEGER AS qtd_concluidas
  FROM dias d
  LEFT JOIN entradas e ON e.dia = d.dia
  LEFT JOIN concluidas c ON c.dia = d.dia
  ORDER BY d.dia ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_produtividade_notas_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ
)
RETURNS TABLE(
  administrador_id UUID,
  nome TEXT,
  avatar_url TEXT,
  especialidade TEXT,
  concluidas_periodo INTEGER,
  concluidas_periodo_anterior INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH periodo AS (
    SELECT
      p_start_iso AS start_iso,
      p_end_exclusive_iso AS end_exclusive_iso,
      (p_end_exclusive_iso - p_start_iso) AS span
  ),
  conclusoes_unicas AS (
    SELECT
      h.nota_id,
      n.administrador_id,
      MIN(h.created_at) AS concluida_em
    FROM public.notas_historico h
    JOIN public.notas_manutencao n ON n.id = h.nota_id
    WHERE h.campo_alterado = 'status'
      AND h.valor_novo = 'concluida'
      AND n.administrador_id IS NOT NULL
    GROUP BY h.nota_id, n.administrador_id
  ),
  agg AS (
    SELECT
      c.administrador_id,
      COUNT(*) FILTER (
        WHERE c.concluida_em >= p.start_iso
          AND c.concluida_em < p.end_exclusive_iso
      )::INTEGER AS concluidas_periodo,
      COUNT(*) FILTER (
        WHERE c.concluida_em >= (p.start_iso - p.span)
          AND c.concluida_em < p.start_iso
      )::INTEGER AS concluidas_periodo_anterior
    FROM conclusoes_unicas c
    CROSS JOIN periodo p
    GROUP BY c.administrador_id
  )
  SELECT
    a.id AS administrador_id,
    a.nome,
    a.avatar_url,
    a.especialidade::TEXT AS especialidade,
    COALESCE(agg.concluidas_periodo, 0)::INTEGER AS concluidas_periodo,
    COALESCE(agg.concluidas_periodo_anterior, 0)::INTEGER AS concluidas_periodo_anterior
  FROM public.administradores a
  LEFT JOIN agg ON agg.administrador_id = a.id
  WHERE a.role = 'admin'
  ORDER BY concluidas_periodo DESC, a.nome ASC;
$$;

CREATE OR REPLACE FUNCTION public.buscar_ordens_prioritarias_dashboard(
  p_start_iso TIMESTAMPTZ,
  p_end_exclusive_iso TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.vw_ordens_notas_painel
LANGUAGE sql
STABLE
AS $$
  SELECT v.*
  FROM public.vw_ordens_notas_painel v
  JOIN public.ordens_notas_acompanhamento o ON o.id = v.ordem_id
  WHERE COALESCE(o.data_entrada, o.ordem_detectada_em) >= p_start_iso
    AND COALESCE(o.data_entrada, o.ordem_detectada_em) < p_end_exclusive_iso
  ORDER BY
    CASE v.semaforo_atraso
      WHEN 'vermelho' THEN 3
      WHEN 'amarelo' THEN 2
      WHEN 'verde' THEN 1
      ELSE 0
    END DESC,
    CASE
      WHEN v.status_ordem IN ('concluida', 'cancelada') THEN 0
      ELSE 1
    END DESC,
    COALESCE(o.data_entrada, o.ordem_detectada_em) DESC,
    v.ordem_codigo ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 1000);
$$;
