-- 00100_operacionais_fornecedor.sql
-- Adiciona rastreamento de operacionais (fornecedores) às ordens de manutenção.
--
-- Mudanças:
-- 1. Tabela dim_operacionais com seed dos colaboradores conhecidos
-- 2. Novos campos em ordens_notas_acompanhamento: fornecedor_codigo, fornecedor_nome, texto_breve
-- 3. Atualiza importar_ordens_pmpl_standalone para persistir os novos campos (lookup nome via dim_operacionais)
-- 4. Atualiza enriquecer_ordens_por_referencia_manutencao para enriquecer texto_breve
-- 5. Novas RPCs de métricas: calcular_kpis_operacionais, calcular_produtividade_operacionais,
--    calcular_servicos_mais_feitos

-- ============================================================
-- 1) Tabela de operacionais conhecidos (lookup código → nome)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dim_operacionais (
  codigo      TEXT        PRIMARY KEY,
  nome        TEXT        NOT NULL,
  ativo       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dim_operacionais IS
  'Cadastro de operacionais (fornecedores externos) que executam ordens de manutenção. Código vem da coluna FORNECEDOR da pmpl_pmos.';

-- Seed: operacionais conhecidos
INSERT INTO public.dim_operacionais (codigo, nome) VALUES
  ('6923',  'ARINALDO DOS SANTOS VIANA'),
  ('14070', 'ANAZILDO MACEDO DA SILVA'),
  ('14606', 'CLAUDIO COSTA LIMA'),
  ('22578', 'CLAUDIOMAR LOPES DA SILVA'),
  ('22016', 'EDESON MONTEIRO SOUSA'),
  ('14069', 'ERICK SILVA PEREIRA'),
  ('10262', 'OTAVIO LUIS MEDEIROS DE AZEVEDO'),
  ('18865', 'RAIMUNDO GONZAGA DO NASCIMENTO')
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, updated_at = now();

-- ============================================================
-- 2) Novos campos em ordens_notas_acompanhamento
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS fornecedor_codigo TEXT,
  ADD COLUMN IF NOT EXISTS fornecedor_nome   TEXT,
  ADD COLUMN IF NOT EXISTS texto_breve       TEXT;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.fornecedor_codigo IS
  'Código do fornecedor/operacional que executa a ordem (vem da coluna FORNECEDOR da pmpl_pmos).';
COMMENT ON COLUMN public.ordens_notas_acompanhamento.fornecedor_nome IS
  'Nome do fornecedor/operacional que executa a ordem.';
COMMENT ON COLUMN public.ordens_notas_acompanhamento.texto_breve IS
  'Descrição curta da ordem (TEXTO_BREVE do SAP). Populado via ordens_manutencao_referencia ou pmpl_pmos.';

CREATE INDEX IF NOT EXISTS idx_ordens_fornecedor_codigo
  ON public.ordens_notas_acompanhamento(fornecedor_codigo)
  WHERE fornecedor_codigo IS NOT NULL;

-- ============================================================
-- 3) Atualiza importar_ordens_pmpl_standalone para persistir os novos campos
-- ============================================================
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
    v_total        := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN CONTINUE; END IF;

    v_status_raw          := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo         := public.normalizar_status_ordem(v_status_raw);
    v_centro              := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_tipo_ordem          := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_criado_por_sap      := NULLIF(BTRIM(v_item ->> 'criado_por_sap_codigo'), '');
    v_fornecedor_codigo   := NULLIF(BTRIM(v_item ->> 'fornecedor_codigo'), '');
    v_texto_breve         := NULLIF(BTRIM(v_item ->> 'texto_breve'), '');

    -- Resolve nome do operacional via lookup (a fonte não fornece o nome)
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
      status_ordem         = EXCLUDED.status_ordem,
      status_ordem_raw     = COALESCE(EXCLUDED.status_ordem_raw,    ordens_notas_acompanhamento.status_ordem_raw),
      centro               = COALESCE(EXCLUDED.centro,              ordens_notas_acompanhamento.centro),
      unidade              = COALESCE(EXCLUDED.unidade,             ordens_notas_acompanhamento.unidade),
      data_entrada         = CASE
        WHEN EXCLUDED.data_entrada IS NULL                          THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL       THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem           = COALESCE(EXCLUDED.tipo_ordem,          ordens_notas_acompanhamento.tipo_ordem),
      criado_por_sap_codigo = COALESCE(EXCLUDED.criado_por_sap_codigo, ordens_notas_acompanhamento.criado_por_sap_codigo),
      fornecedor_codigo    = COALESCE(EXCLUDED.fornecedor_codigo,   ordens_notas_acompanhamento.fornecedor_codigo),
      -- Nome sempre vem do lookup dim_operacionais; mantém o existente se o lookup não encontrou
      fornecedor_nome      = COALESCE(EXCLUDED.fornecedor_nome,     ordens_notas_acompanhamento.fornecedor_nome),
      texto_breve          = COALESCE(EXCLUDED.texto_breve,         ordens_notas_acompanhamento.texto_breve),
      status_atualizado_em = now(),
      sync_id              = COALESCE(EXCLUDED.sync_id,             ordens_notas_acompanhamento.sync_id),
      updated_at           = now();

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;

  END LOOP;

  RETURN QUERY SELECT v_total, v_inseridas, v_atualizadas;
END;
$$;

-- ============================================================
-- 4) Enriquece texto_breve a partir de ordens_manutencao_referencia
-- ============================================================
CREATE OR REPLACE FUNCTION public.enriquecer_ordens_por_referencia_manutencao()
RETURNS TABLE(
  ordens_atualizadas_total INTEGER,
  tipo_ordem_atualizadas INTEGER,
  centro_preenchidos INTEGER,
  numero_nota_preenchidas INTEGER
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ref AS (
    SELECT
      r.ordem_codigo_norm,
      NULLIF(BTRIM(r.tipo_ordem), '') AS tipo_ordem_ref,
      NULLIF(BTRIM(r.centro_liberacao), '') AS centro_liberacao_ref,
      NULLIF(BTRIM(r.numero_nota_norm), '') AS numero_nota_ref,
      NULLIF(BTRIM(r.texto_breve), '') AS texto_breve_ref
    FROM public.ordens_manutencao_referencia r
  ),
  pre_candidatos AS (
    SELECT
      o.id,
      o.tipo_ordem AS tipo_ordem_old,
      o.centro AS centro_old,
      o.numero_nota AS numero_nota_old,
      o.texto_breve AS texto_breve_old,
      ref.tipo_ordem_ref,
      ref.centro_liberacao_ref,
      ref.numero_nota_ref,
      ref.texto_breve_ref
    FROM public.ordens_notas_acompanhamento o
    JOIN ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    WHERE
      (
        ref.tipo_ordem_ref IS NOT NULL
        AND ref.tipo_ordem_ref IS DISTINCT FROM o.tipo_ordem
      )
      OR (
        (o.centro IS NULL OR BTRIM(o.centro) = '')
        AND ref.centro_liberacao_ref IS NOT NULL
      )
      OR (
        (o.numero_nota IS NULL OR BTRIM(o.numero_nota) = '')
        AND ref.numero_nota_ref IS NOT NULL
      )
      OR (
        (o.texto_breve IS NULL OR BTRIM(o.texto_breve) = '')
        AND ref.texto_breve_ref IS NOT NULL
      )
  ),
  notas_referencia AS (
    SELECT DISTINCT p.numero_nota_ref AS numero_nota
    FROM pre_candidatos p
    WHERE p.numero_nota_ref IS NOT NULL
  ),
  notas_existentes AS (
    SELECT n.numero_nota
    FROM public.notas_manutencao n
    JOIN notas_referencia nr ON nr.numero_nota = n.numero_nota
  ),
  updates AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      tipo_ordem   = COALESCE(p.tipo_ordem_ref, o.tipo_ordem),
      centro       = CASE
                       WHEN (o.centro IS NULL OR BTRIM(o.centro) = '') AND p.centro_liberacao_ref IS NOT NULL
                       THEN p.centro_liberacao_ref
                       ELSE o.centro
                     END,
      numero_nota  = CASE
                       WHEN (o.numero_nota IS NULL OR BTRIM(o.numero_nota) = '')
                         AND p.numero_nota_ref IS NOT NULL
                         AND p.numero_nota_ref IN (SELECT ne.numero_nota FROM notas_existentes ne)
                       THEN p.numero_nota_ref
                       ELSE o.numero_nota
                     END,
      texto_breve  = CASE
                       WHEN (o.texto_breve IS NULL OR BTRIM(o.texto_breve) = '') AND p.texto_breve_ref IS NOT NULL
                       THEN p.texto_breve_ref
                       ELSE o.texto_breve
                     END,
      updated_at   = now()
    FROM pre_candidatos p
    WHERE o.id = p.id
    RETURNING
      o.id,
      (p.tipo_ordem_ref IS NOT NULL AND p.tipo_ordem_ref IS DISTINCT FROM p.tipo_ordem_old) AS tipo_mudou,
      ((p.centro_old IS NULL OR BTRIM(p.centro_old) = '') AND p.centro_liberacao_ref IS NOT NULL) AS centro_mudou,
      ((p.numero_nota_old IS NULL OR BTRIM(p.numero_nota_old) = '') AND p.numero_nota_ref IS NOT NULL
        AND p.numero_nota_ref IN (SELECT ne.numero_nota FROM notas_existentes ne)) AS nota_mudou
  )
  SELECT
    COUNT(*)::INTEGER AS ordens_atualizadas_total,
    COUNT(*) FILTER (WHERE tipo_mudou)::INTEGER AS tipo_ordem_atualizadas,
    COUNT(*) FILTER (WHERE centro_mudou)::INTEGER AS centro_preenchidos,
    COUNT(*) FILTER (WHERE nota_mudou)::INTEGER AS numero_nota_preenchidas
  FROM updates;
END;
$$;

-- ============================================================
-- 4) RPC calcular_kpis_operacionais
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_kpis_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ
)
RETURNS TABLE(
  total_operacionais   INTEGER,
  ordens_atendidas     INTEGER,
  ordens_em_aberto     INTEGER,
  lojas_atendidas      INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT o.fornecedor_codigo)::INTEGER AS total_operacionais,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER AS ordens_atendidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta', 'em_tratativa'))::INTEGER AS ordens_em_aberto,
    COUNT(DISTINCT o.unidade) FILTER (WHERE o.status_ordem = 'concluida' AND o.unidade IS NOT NULL)::INTEGER AS lojas_atendidas
  FROM public.ordens_notas_acompanhamento o
  WHERE
    o.fornecedor_codigo IS NOT NULL
    AND o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim;
END;
$$;

-- ============================================================
-- 5) RPC calcular_produtividade_operacionais
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_produtividade_operacionais(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 50
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
BEGIN
  RETURN QUERY
  SELECT
    o.fornecedor_codigo,
    MAX(o.fornecedor_nome) AS fornecedor_nome,
    COUNT(*)::INTEGER AS total_ordens,
    COUNT(*) FILTER (WHERE o.status_ordem = 'concluida')::INTEGER AS atendidas,
    COUNT(*) FILTER (WHERE o.status_ordem IN ('aberta', 'em_tratativa'))::INTEGER AS em_aberto,
    COUNT(DISTINCT o.unidade) FILTER (WHERE o.status_ordem = 'concluida' AND o.unidade IS NOT NULL)::INTEGER AS lojas_atendidas,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE COUNT(*) FILTER (WHERE o.status_ordem = 'concluida') * 100.0 / COUNT(*)
      END,
      1
    ) AS pct_conclusao
  FROM public.ordens_notas_acompanhamento o
  WHERE
    o.fornecedor_codigo IS NOT NULL
    AND o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
  GROUP BY o.fornecedor_codigo
  ORDER BY atendidas DESC, total_ordens DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================
-- 6) RPC calcular_servicos_mais_feitos
-- ============================================================
CREATE OR REPLACE FUNCTION public.calcular_servicos_mais_feitos(
  p_data_inicio        TIMESTAMPTZ,
  p_data_fim           TIMESTAMPTZ,
  p_limit              INTEGER DEFAULT 10
)
RETURNS TABLE(
  texto_breve          TEXT,
  quantidade           INTEGER,
  pct_total            NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      o.texto_breve,
      COUNT(*)::INTEGER AS quantidade
    FROM public.ordens_notas_acompanhamento o
    WHERE
      o.texto_breve IS NOT NULL
      AND BTRIM(o.texto_breve) <> ''
      AND o.fornecedor_codigo IS NOT NULL
      AND o.ordem_detectada_em >= p_data_inicio
      AND o.ordem_detectada_em < p_data_fim
    GROUP BY o.texto_breve
    ORDER BY quantidade DESC
    LIMIT p_limit
  ),
  total AS (
    SELECT COALESCE(SUM(b.quantidade), 1) AS soma FROM base b
  )
  SELECT
    b.texto_breve,
    b.quantidade,
    ROUND(b.quantidade * 100.0 / t.soma, 1) AS pct_total
  FROM base b, total t
  ORDER BY b.quantidade DESC;
END;
$$;
