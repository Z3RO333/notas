-- 00135_gestao_denominacao_unidade.sql
-- Separa unidades que compartilham o mesmo centro SAP, como
-- Loja Matriz, Escritorio Central e Escritorio Central Anexo I.
--
-- Mudancas:
-- 1. Persiste a coluna denominacao_unidade em ordens_notas_acompanhamento
-- 2. Atualiza importar_ordens_pmpl_standalone para aceitar a denominacao do SAP
-- 3. Faz o painel de gestao agrupar/exibir por denominacao quando ela existir
--    sem perder a classificacao base LOJA/FARMA/CD via unidade

ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS denominacao_unidade TEXT;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.denominacao_unidade IS
  'Rotulo da unidade no SAP (coluna Denominacao). Permite separar unidades que compartilham o mesmo centro, como Loja Matriz e Escritorio Central.';

CREATE INDEX IF NOT EXISTS idx_ordens_denominacao_unidade
  ON public.ordens_notas_acompanhamento (denominacao_unidade)
  WHERE denominacao_unidade IS NOT NULL AND BTRIM(denominacao_unidade) <> '';

CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders  JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item                 JSONB;
  v_ordem_codigo         TEXT;
  v_status_raw           TEXT;
  v_status_novo          public.ordem_status_acomp;
  v_centro               TEXT;
  v_unidade              TEXT;
  v_denominacao_unidade  TEXT;
  v_data_raw             TEXT;
  v_data_entrada         TIMESTAMPTZ;
  v_tipo_ordem           TEXT;
  v_criado_por_sap       TEXT;
  v_fornecedor_codigo    TEXT;
  v_fornecedor_nome      TEXT;
  v_texto_breve          TEXT;
  v_exists               BOOLEAN;
  v_total                INTEGER := 0;
  v_inseridas            INTEGER := 0;
  v_atualizadas          INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    v_total                := v_total + 1;
    v_ordem_codigo         := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN CONTINUE; END IF;

    v_status_raw           := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo          := public.normalizar_status_ordem(v_status_raw);
    v_centro               := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_denominacao_unidade  := NULLIF(BTRIM(v_item ->> 'denominacao_unidade'), '');
    v_tipo_ordem           := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_criado_por_sap       := NULLIF(BTRIM(v_item ->> 'criado_por_sap_codigo'), '');
    v_fornecedor_codigo    := NULLIF(BTRIM(v_item ->> 'fornecedor_codigo'), '');
    v_texto_breve          := NULLIF(BTRIM(v_item ->> 'texto_breve'), '');

    v_fornecedor_nome := NULL;
    IF v_fornecedor_codigo IS NOT NULL THEN
      SELECT d.nome INTO v_fornecedor_nome
      FROM public.dim_operacionais d
      WHERE d.codigo = v_fornecedor_codigo;
    END IF;

    v_data_raw     := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        v_data_entrada := NULL;
      END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.ordens_notas_acompanhamento
      WHERE ordem_codigo = v_ordem_codigo
    ) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      ordem_codigo,
      status_ordem,
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
      ordem_detectada_em
    )
    VALUES (
      NULL,
      v_ordem_codigo,
      v_status_novo,
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
      COALESCE(v_data_entrada, now())
    )
    ON CONFLICT (ordem_codigo) DO UPDATE
    SET
      status_ordem          = EXCLUDED.status_ordem,
      status_ordem_raw      = COALESCE(EXCLUDED.status_ordem_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro                = COALESCE(EXCLUDED.centro, ordens_notas_acompanhamento.centro),
      unidade               = COALESCE(EXCLUDED.unidade, ordens_notas_acompanhamento.unidade),
      denominacao_unidade   = COALESCE(EXCLUDED.denominacao_unidade, ordens_notas_acompanhamento.denominacao_unidade),
      data_entrada          = CASE
        WHEN EXCLUDED.data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem            = COALESCE(EXCLUDED.tipo_ordem, ordens_notas_acompanhamento.tipo_ordem),
      criado_por_sap_codigo = COALESCE(EXCLUDED.criado_por_sap_codigo, ordens_notas_acompanhamento.criado_por_sap_codigo),
      fornecedor_codigo     = COALESCE(EXCLUDED.fornecedor_codigo, ordens_notas_acompanhamento.fornecedor_codigo),
      fornecedor_nome       = COALESCE(EXCLUDED.fornecedor_nome, ordens_notas_acompanhamento.fornecedor_nome),
      texto_breve           = COALESCE(EXCLUDED.texto_breve, ordens_notas_acompanhamento.texto_breve),
      status_atualizado_em  = now(),
      sync_id               = COALESCE(EXCLUDED.sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at            = now();

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_inseridas, v_atualizadas;
END;
$$;

DROP VIEW IF EXISTS public.vw_dashboard_gestao_manutencao;

CREATE VIEW public.vw_dashboard_gestao_manutencao AS
SELECT
  COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)                   AS nome_loja,
  n.centro,
  n.descricao                                                                         AS texto_breve,
  ona.tipo_ordem,
  CASE
    WHEN upper(ona.unidade) LIKE 'CD %'
      THEN 'CD'
    WHEN upper(ona.unidade) LIKE 'FARMA %'
      OR upper(ona.unidade) LIKE 'BEMOL FARMA %'
      THEN 'FARMA'
    WHEN ona.unidade IS NOT NULL
      THEN 'LOJA'
    ELSE NULL
  END                                                                                 AS tipo_unidade,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int           AS ano,
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int           AS mes,
  COUNT(DISTINCT ona.id)                                                              AS total_ordens,
  COUNT(DISTINCT n.id)                                                                AS total_notas
FROM public.notas_manutencao n
LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
WHERE n.descricao <> ''
GROUP BY
  COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade),
  ona.unidade,
  n.centro,
  n.descricao,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date)),
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date));

CREATE OR REPLACE FUNCTION public.calcular_gestao_top_lojas_por_status(
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL,
  p_tipo_ordem TEXT    DEFAULT NULL
)
RETURNS TABLE(
  nome_loja    TEXT,
  tipo_unidade TEXT,
  concluidas   INTEGER,
  em_aberto    INTEGER,
  total_ordens INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade) AS nome_loja,
      CASE
        WHEN UPPER(ona.unidade) LIKE 'CD %' THEN 'CD'
        WHEN UPPER(ona.unidade) LIKE 'FARMA %'
          OR UPPER(ona.unidade) LIKE 'BEMOL FARMA %' THEN 'FARMA'
        WHEN ona.unidade IS NOT NULL THEN 'LOJA'
        ELSE NULL
      END AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.notas_manutencao n
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    WHERE
      BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
      AND (p_tipo_ordem IS NULL OR ona.tipo_ordem = p_tipo_ordem)
  )
  SELECT
    b.nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto,
    COUNT(*)::INTEGER                                                      AS total_ordens
  FROM base b
  WHERE
    b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;
