-- 00226_concluido_em_campo_dedicado.sql
--
-- Problema: status_atualizado_em é sobrescrito a cada sync, tornando-o
-- inapropriado para identificar "quando a ordem foi concluída".
--
-- Solução: adicionar concluido_em TIMESTAMPTZ que é setado UMA ÚNICA VEZ
-- na primeira transição para status final e nunca é sobrescrito.
--
-- As 5 RPCs de produtividade (migration 00225) passam a usar concluido_em
-- como referência de período para ordens concluídas.
-- Ordens sem concluido_em (históricas, dado indisponível) usam
-- ordem_detectada_em como fallback conservador.

-- ── 1. Coluna ────────────────────────────────────────────────────────────────

ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.concluido_em IS
  'Data/hora da primeira transição para status final. Setada apenas uma vez, nunca sobrescrita.';

-- ── 2. Trigger: seta concluido_em na primeira transição para final ────────────

CREATE OR REPLACE FUNCTION public.set_concluido_em()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status_finais CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CANCELADA','CONCLUIDO','CONCLUIDA',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
BEGIN
  -- Só seta se ainda não foi setado e o novo status é final
  IF NEW.concluido_em IS NULL
     AND UPPER(BTRIM(COALESCE(NEW.status_ordem_raw, ''))) = ANY(v_status_finais)
  THEN
    NEW.concluido_em := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_concluido_em'
  ) THEN
    CREATE TRIGGER trg_set_concluido_em
      BEFORE INSERT OR UPDATE OF status_ordem_raw
      ON public.ordens_notas_acompanhamento
      FOR EACH ROW
      EXECUTE FUNCTION public.set_concluido_em();
  END IF;
END;
$$;

-- ── 3. Backfill: ordens já finais com status_atualizado_em anterior a hoje ───
-- Usa status_atualizado_em apenas para registros não tocados pelo sync de hoje.
-- Registros cujo status_atualizado_em foi corrompido (= hoje) ficam com NULL
-- e usarão ordem_detectada_em como fallback nas RPCs.

UPDATE public.ordens_notas_acompanhamento
SET concluido_em = status_atualizado_em
WHERE concluido_em IS NULL
  AND UPPER(BTRIM(COALESCE(status_ordem_raw, ''))) = ANY(ARRAY[
    'CANCELADO','CANCELADA','CONCLUIDO','CONCLUIDA',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ])
  AND DATE(status_atualizado_em) < CURRENT_DATE;

-- ── 4. Atualizar as 5 RPCs para usar concluido_em ────────────────────────────
-- Fallback: COALESCE(concluido_em, ordem_detectada_em) para ordens sem data
-- de conclusão confiável (históricas ou com dado corrompido).

-- ── calcular_kpis_operacionais ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_operacionais   INTEGER,
  ordens_atendidas     INTEGER,
  ordens_em_aberto     INTEGER,
  lojas_atendidas      INTEGER,
  total_ordens         INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) >= p_data_inicio
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    COUNT(DISTINCT b.fornecedor_codigo)::INTEGER AS total_operacionais,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS ordens_atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS ordens_em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas,
    COUNT(*)::INTEGER AS total_ordens
  FROM base b;
END;
$$;

-- ── calcular_produtividade_operacionais ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_produtividade_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 50,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_codigo    TEXT,
  fornecedor_nome      TEXT,
  total_ordens         INTEGER,
  atendidas            INTEGER,
  em_aberto            INTEGER,
  lojas_atendidas      INTEGER,
  pct_conclusao        NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      d.nome AS fornecedor_nome,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) >= p_data_inicio
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.fornecedor_codigo,
    b.fornecedor_nome,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS em_aberto,
    COUNT(DISTINCT b.unidade) FILTER (
      WHERE b.raw_norm = ANY(v_status_concluidos)
        AND b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
    )::INTEGER AS lojas_atendidas,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END, 1
    ) AS pct_conclusao
  FROM base b
  GROUP BY b.fornecedor_codigo, b.fornecedor_nome
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

-- ── calcular_lojas_por_operacional ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_lojas_por_operacional(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_codigo TEXT,
  unidade           TEXT,
  qtd_atendidas     INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.fornecedor_codigo,
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
      AND COALESCE(o.concluido_em, o.ordem_detectada_em) >= p_data_inicio
      AND COALESCE(o.concluido_em, o.ordem_detectada_em) < p_data_fim
      AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
      AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.fornecedor_codigo,
    b.unidade,
    COUNT(*)::INTEGER AS qtd_atendidas
  FROM base b
  WHERE b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
  GROUP BY b.fornecedor_codigo, b.unidade
  ORDER BY b.fornecedor_codigo, qtd_atendidas DESC;
END;
$$;

-- ── calcular_evolucao_mensal_operacionais ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_evolucao_mensal_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  ano        INTEGER,
  mes        INTEGER,
  label      TEXT,
  concluidas INTEGER,
  em_aberto  INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm,
      CASE
        WHEN UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
          THEN COALESCE(o.concluido_em, o.ordem_detectada_em)
        ELSE o.ordem_detectada_em
      END AS data_ref
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) >= p_data_inicio
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    EXTRACT(YEAR  FROM b.data_ref)::INTEGER                    AS ano,
    EXTRACT(MONTH FROM b.data_ref)::INTEGER                    AS mes,
    TO_CHAR(DATE_TRUNC('month', b.data_ref), 'Mon/YY')         AS label,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto
  FROM base b
  GROUP BY ano, mes, label
  ORDER BY ano, mes;
END;
$$;

-- ── calcular_produtividade_por_loja ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_produtividade_por_loja(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 20,
  p_fornecedor_codigo  TEXT DEFAULT NULL,
  p_especialidade      TEXT DEFAULT NULL
)
RETURNS TABLE(
  unidade       TEXT,
  total_ordens  INTEGER,
  atendidas     INTEGER,
  em_aberto     INTEGER,
  pct_conclusao NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status_concluidos CONSTANT TEXT[] := ARRAY[
    'CANCELADO','CONCLUIDO','AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO','ABERTA','EM_EXECUCAO','EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA','ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO','EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.unidade,
      UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento o
    JOIN public.dim_operacionais d
      ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
    WHERE (
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_concluidos)
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) >= p_data_inicio
        AND COALESCE(o.concluido_em, o.ordem_detectada_em) < p_data_fim)
      OR
      (UPPER(BTRIM(COALESCE(o.status_ordem_raw, ''))) = ANY(v_status_abertos)
        AND o.ordem_detectada_em >= p_data_inicio
        AND o.ordem_detectada_em < p_data_fim)
    )
    AND (p_fornecedor_codigo IS NULL OR d.codigo = p_fornecedor_codigo)
    AND (p_especialidade IS NULL OR d.especialidade = p_especialidade)
  )
  SELECT
    b.unidade,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER  AS em_aberto,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos)) * 100.0 / COUNT(*)
      END, 1
    ) AS pct_conclusao
  FROM base b
  WHERE b.unidade IS NOT NULL AND BTRIM(b.unidade) <> ''
  GROUP BY b.unidade
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;
