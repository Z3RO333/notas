-- 00242_concluida_em_ordens.sql
--
-- Problema: concluido_em é setado pelo trigger com now() (hora do sync),
-- não com a data real que o SAP registrou a conclusão.
-- Resultado: tempo_medio_conclusao inflado (conta tempo de backlog do sync).
--
-- Solução: os dois RPCs de upsert agora passam DATA_ATUALIZACAO explicitamente
-- como concluido_em na primeira transição para CONCLUIDO. O trigger existente
-- (trg_set_concluido_em) continua como fallback para quando DATA_ATUALIZACAO
-- não estiver disponível — o trigger só seta se NEW.concluido_em IS NULL.
--
-- Não cria coluna nova: concluido_em já existe desde 00226.

-- ============================================================
-- 1) importar_ordens_pmpl_standalone — passa data_atualizacao
--    como concluido_em para que o trigger não use now()
-- ============================================================
CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_item                JSONB;
  v_ordem_codigo        TEXT;
  v_status_raw          TEXT;
  v_centro              TEXT;
  v_unidade             TEXT;
  v_denominacao_unidade TEXT;
  v_data_raw            TEXT;
  v_data_entrada        TIMESTAMPTZ;
  v_data_atualiz_raw    TEXT;
  v_data_atualiz        TIMESTAMPTZ;
  v_tipo_ordem          TEXT;
  v_criado_por_sap      TEXT;
  v_fornecedor_codigo   TEXT;
  v_fornecedor_nome     TEXT;
  v_texto_breve         TEXT;
  v_exists              BOOLEAN;
  v_total               INTEGER := 0;
  v_inseridas           INTEGER := 0;
  v_atualizadas         INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw          := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_centro              := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_denominacao_unidade := NULLIF(BTRIM(v_item ->> 'denominacao_unidade'), '');
    v_tipo_ordem          := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_criado_por_sap      := NULLIF(BTRIM(v_item ->> 'criado_por_sap_codigo'), '');
    v_fornecedor_codigo   := NULLIF(BTRIM(v_item ->> 'fornecedor_codigo'), '');
    v_texto_breve         := NULLIF(BTRIM(v_item ->> 'texto_breve'), '');

    v_fornecedor_nome := NULL;
    IF v_fornecedor_codigo IS NOT NULL THEN
      SELECT d.nome
      INTO v_fornecedor_nome
      FROM public.dim_operacionais d
      WHERE d.codigo = v_fornecedor_codigo;
    END IF;

    v_data_raw     := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    -- DATA_ATUALIZACAO do SAP: usado como concluido_em para evitar que o trigger
    -- use now() (hora do sync) como data de conclusão
    v_data_atualiz_raw := NULLIF(BTRIM(v_item ->> 'data_atualizacao'), '');
    v_data_atualiz     := NULL;
    IF v_data_atualiz_raw IS NOT NULL THEN
      BEGIN
        v_data_atualiz := v_data_atualiz_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_atualiz := NULL;
      END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade
      INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.ordens_notas_acompanhamento
      WHERE ordem_codigo = v_ordem_codigo
    ) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      ordem_codigo,
      status_ordem_raw,
      centro,
      unidade,
      denominacao_unidade,
      data_entrada,
      tipo_ordem,
      criado_por_sap_codigo,
      fornecedor_codigo,
      fornecedor_nome,
      texto_breve,
      sync_id,
      ordem_detectada_em,
      -- Passa explicitamente para o trigger ver NOT NULL e não usar now()
      concluido_em
    )
    VALUES (
      NULL,
      v_ordem_codigo,
      v_status_raw,
      v_centro,
      v_unidade,
      v_denominacao_unidade,
      v_data_entrada,
      v_tipo_ordem,
      v_criado_por_sap,
      v_fornecedor_codigo,
      v_fornecedor_nome,
      v_texto_breve,
      p_sync_id,
      COALESCE(v_data_entrada, now()),
      CASE WHEN v_status_raw = 'CONCLUIDO' THEN v_data_atualiz ELSE NULL END
    )
    ON CONFLICT (ordem_codigo) DO UPDATE
    SET
      status_ordem_raw      = COALESCE(EXCLUDED.status_ordem_raw,      ordens_notas_acompanhamento.status_ordem_raw),
      centro                = COALESCE(EXCLUDED.centro,                ordens_notas_acompanhamento.centro),
      unidade               = COALESCE(EXCLUDED.unidade,               ordens_notas_acompanhamento.unidade),
      denominacao_unidade   = COALESCE(EXCLUDED.denominacao_unidade,   ordens_notas_acompanhamento.denominacao_unidade),
      data_entrada          = CASE
        WHEN EXCLUDED.data_entrada IS NULL                             THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL          THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem            = COALESCE(EXCLUDED.tipo_ordem,            ordens_notas_acompanhamento.tipo_ordem),
      criado_por_sap_codigo = COALESCE(EXCLUDED.criado_por_sap_codigo, ordens_notas_acompanhamento.criado_por_sap_codigo),
      fornecedor_codigo     = COALESCE(EXCLUDED.fornecedor_codigo,     ordens_notas_acompanhamento.fornecedor_codigo),
      fornecedor_nome       = COALESCE(EXCLUDED.fornecedor_nome,       ordens_notas_acompanhamento.fornecedor_nome),
      texto_breve           = COALESCE(EXCLUDED.texto_breve,           ordens_notas_acompanhamento.texto_breve),
      status_atualizado_em  = now(),
      sync_id               = COALESCE(EXCLUDED.sync_id,               ordens_notas_acompanhamento.sync_id),
      updated_at            = now(),
      -- Só seta na primeira transição para CONCLUIDO com DATA_ATUALIZACAO disponível.
      -- Quando NULL: o trigger (trg_set_concluido_em) entra como fallback com now().
      concluido_em          = CASE
        WHEN ordens_notas_acompanhamento.concluido_em IS NOT NULL        THEN ordens_notas_acompanhamento.concluido_em
        WHEN EXCLUDED.status_ordem_raw = 'CONCLUIDO'
             AND EXCLUDED.concluido_em IS NOT NULL                       THEN EXCLUDED.concluido_em
        ELSE ordens_notas_acompanhamento.concluido_em
      END;

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_total, v_inseridas, v_atualizadas;
END;
$function$;

-- ============================================================
-- 2) atualizar_status_ordens_pmpl_lote — passa data_atualizacao
--    como concluido_em para que o trigger não use now()
-- ============================================================
CREATE OR REPLACE FUNCTION public.atualizar_status_ordens_pmpl_lote(
  p_updates JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, ordens_atualizadas INTEGER, mudancas_status INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item              JSONB;
  v_ordem             public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo      TEXT;
  v_status_raw        TEXT;
  v_status_novo       public.ordem_status_acomp;
  v_status_anterior   public.ordem_status_acomp;
  v_centro            TEXT;
  v_unidade           TEXT;
  v_data_entrada_raw  TEXT;
  v_data_entrada      TIMESTAMPTZ;
  v_data_atualiz_raw  TEXT;
  v_data_atualiz      TIMESTAMPTZ;
  v_tipo_ordem        TEXT;
  v_total             INTEGER := 0;
  v_atualizadas       INTEGER := 0;
  v_mudancas          INTEGER := 0;
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

    v_status_raw       := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_centro           := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_data_entrada_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada     := NULL;
    v_tipo_ordem       := NULLIF(BTRIM(v_item ->> 'tipo_ordem'), '');

    IF v_data_entrada_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_entrada_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    v_data_atualiz_raw := NULLIF(BTRIM(v_item ->> 'data_atualizacao'), '');
    v_data_atualiz     := NULL;
    IF v_data_atualiz_raw IS NOT NULL THEN
      BEGIN
        v_data_atualiz := v_data_atualiz_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_atualiz := NULL;
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

    v_status_anterior := public.normalizar_status_ordem(v_ordem.status_ordem_raw);
    v_status_novo := CASE
      WHEN v_status_raw IS NULL THEN v_status_anterior
      ELSE public.normalizar_status_ordem(v_status_raw)
    END;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade
      INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET
      status_ordem_raw     = COALESCE(v_status_raw,   ordens_notas_acompanhamento.status_ordem_raw),
      centro               = COALESCE(v_centro,        ordens_notas_acompanhamento.centro),
      unidade              = COALESCE(v_unidade,       ordens_notas_acompanhamento.unidade),
      data_entrada         = CASE
        WHEN v_data_entrada IS NULL                              THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL    THEN v_data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, v_data_entrada)
      END,
      tipo_ordem           = COALESCE(v_tipo_ordem,   ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id              = COALESCE(p_sync_id,       ordens_notas_acompanhamento.sync_id),
      updated_at           = now(),
      -- Seta explicitamente com DATA_ATUALIZACAO para que o trigger não use now().
      -- Se NULL: o trigger entra como fallback. Se já setado: nunca sobrescreve.
      concluido_em         = CASE
        WHEN ordens_notas_acompanhamento.concluido_em IS NOT NULL      THEN ordens_notas_acompanhamento.concluido_em
        WHEN v_status_raw = 'CONCLUIDO' AND v_data_atualiz IS NOT NULL THEN v_data_atualiz
        ELSE ordens_notas_acompanhamento.concluido_em
      END
    WHERE id = v_ordem.id;

    v_atualizadas := v_atualizadas + 1;

    IF v_status_raw IS NOT NULL
       AND v_status_anterior IS DISTINCT FROM v_status_novo THEN
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
        v_status_anterior,
        v_status_novo,
        v_status_raw,
        'pmpl_sync',
        p_sync_id
      );

      v_mudancas := v_mudancas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_total, v_atualizadas, v_mudancas;
END;
$function$;

-- ============================================================
-- 3) vw_produtividade_detalhada — usa concluido_em da ordem
--    em vez de notas_historico (ação manual do cockpit)
-- ============================================================
CREATE OR REPLACE VIEW public.vw_produtividade_detalhada AS
WITH concluidas AS (
  SELECT
    n.administrador_id,
    o.concluido_em
  FROM public.ordens_notas_acompanhamento o
  JOIN public.notas_manutencao n ON n.id = o.nota_id
  WHERE o.status_ordem_raw = 'CONCLUIDO'
    AND o.concluido_em IS NOT NULL
    AND o.concluido_em >= NOW() - INTERVAL '60 days'
    AND n.administrador_id IS NOT NULL
),
agg AS (
  SELECT
    administrador_id,
    COUNT(*) FILTER (WHERE concluido_em >= NOW() - INTERVAL '7 days')::INT  AS concluidas_7d,
    COUNT(*) FILTER (WHERE concluido_em >= NOW() - INTERVAL '30 days')::INT AS concluidas_30d,
    COUNT(*) FILTER (
      WHERE concluido_em >= NOW() - INTERVAL '60 days'
        AND concluido_em < NOW() - INTERVAL '30 days'
    )::INT AS concluidas_prev_30d
  FROM concluidas
  GROUP BY administrador_id
)
SELECT
  a.id AS administrador_id,
  a.nome,
  a.avatar_url,
  a.especialidade,
  COALESCE(agg.concluidas_7d, 0)       AS concluidas_7d,
  COALESCE(agg.concluidas_30d, 0)      AS concluidas_30d,
  COALESCE(agg.concluidas_prev_30d, 0) AS concluidas_prev_30d,
  ROUND(COALESCE(agg.concluidas_30d, 0)::NUMERIC / 30, 2) AS media_diaria_30d,
  CASE
    WHEN COALESCE(agg.concluidas_prev_30d, 0) > 0
      THEN ROUND(
        ((COALESCE(agg.concluidas_30d, 0) - COALESCE(agg.concluidas_prev_30d, 0))::NUMERIC
        / agg.concluidas_prev_30d) * 100, 1
      )
    ELSE 0
  END AS variacao_pct,
  CASE
    WHEN (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)) > 0
      THEN ROUND(
        COALESCE(agg.concluidas_30d, 0)::NUMERIC
        / (COALESCE(agg.concluidas_30d, 0) + COALESCE(c.qtd_abertas, 0)), 3
      )
    ELSE 0
  END AS eficiencia
FROM public.administradores a
LEFT JOIN agg ON agg.administrador_id = a.id
LEFT JOIN public.vw_carga_real_administradores c ON c.id = a.id
WHERE a.role = 'admin'
  AND (a.recebe_distribuicao OR COALESCE(agg.concluidas_30d, 0) > 0)
ORDER BY COALESCE(agg.concluidas_30d, 0) DESC;

COMMENT ON VIEW public.vw_produtividade_detalhada IS
  'Produtividade por admin. concluidas_* baseado em ordens_notas_acompanhamento.concluido_em '
  '(DATA_ATUALIZACAO do SAP via sync) em vez de notas_historico (ação manual do cockpit). '
  'Corrigido em 00242.';
