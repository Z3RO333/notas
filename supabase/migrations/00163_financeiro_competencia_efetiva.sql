-- 00163_financeiro_competencia_efetiva.sql
--
-- Consolida a regra oficial de competencia financeira:
--   PMOS -> data_entrada
--   PMPL -> COALESCE(inicio_programado, data_entrada)
--
-- Tambem corrige:
-- 1. backfill_data_entrada_from_financeiro para PMPL com fallback
-- 2. funcoes de gestao/equipamentos que exigiam inicio_programado IS NOT NULL
-- 3. comparativos financeiros para que total_gasto represente apenas valor_realizado

ALTER TABLE public.ordens_financeiro_importado
  ALTER COLUMN data_entrada DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_tipo_competencia_efetiva
  ON public.ordens_financeiro_importado (
    tipo_ordem,
    (
      CASE
        WHEN tipo_ordem = 'PMPL' THEN COALESCE(inicio_programado, data_entrada)
        ELSE data_entrada
      END
    )
  );

CREATE OR REPLACE VIEW public.vw_financeiro_ordens AS
SELECT
  f.id,
  f.ordem_codigo,
  f.tipo_ordem,
  f.numero_nota,
  f.data_entrada,
  f.denominacao_unidade,
  f.texto_breve,
  f.fornecedor_codigo,
  f.fornecedor_nome,
  f.custos_estimados,
  f.custos_totais_materiais,
  f.custos_adicionais,
  f.custos_totais_reais,
  EXTRACT(YEAR FROM (
    CASE
      WHEN f.tipo_ordem = 'PMPL' THEN COALESCE(f.inicio_programado, f.data_entrada)
      ELSE f.data_entrada
    END
  ))::INT AS competencia_ano,
  EXTRACT(MONTH FROM (
    CASE
      WHEN f.tipo_ordem = 'PMPL' THEN COALESCE(f.inicio_programado, f.data_entrada)
      ELSE f.data_entrada
    END
  ))::INT AS competencia_mes,
  GREATEST(COALESCE(f.custos_totais_reais, 0), 0::NUMERIC) AS valor_realizado,
  CASE
    WHEN COALESCE(f.custos_totais_reais, 0) > 0 THEN 0::NUMERIC
    ELSE GREATEST(
      GREATEST(COALESCE(f.custos_estimados, 0), 0::NUMERIC),
      GREATEST(COALESCE(f.custos_totais_materiais, 0), 0::NUMERIC)
    )
  END AS valor_previsto_pendente,
  (COALESCE(f.custos_totais_reais, 0) > 0) AS tem_custo_real,
  GREATEST(
    COALESCE(f.custos_totais_reais, 0)
      - COALESCE(f.custos_totais_materiais, 0)
      - COALESCE(f.custos_adicionais, 0),
    0::NUMERIC
  ) AS valor_servico_calculado,
  f.source_file_name,
  f.imported_by,
  f.importado_em,
  f.created_at,
  f.updated_at
FROM public.ordens_financeiro_importado f
WHERE BTRIM(f.ordem_codigo) <> '';

ALTER VIEW public.vw_financeiro_ordens SET (security_invoker = on);

COMMENT ON VIEW public.vw_financeiro_ordens IS
  'Leitura financeira por ordem. PMOS usa data_entrada; PMPL usa COALESCE(inicio_programado, data_entrada). valor_previsto_pendente zera com custo real e, sem custo real, usa o maior entre custos_estimados e custos_totais_materiais.';

CREATE OR REPLACE FUNCTION public.backfill_data_entrada_from_financeiro(p_codigos text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.ordens_notas_acompanhamento ona
  SET
    data_entrada = CASE
      WHEN fi.tipo_ordem = 'PMPL' THEN COALESCE(fi.inicio_programado, fi.data_entrada)
      ELSE fi.data_entrada
    END,
    updated_at = NOW()
  FROM public.ordens_financeiro_importado fi
  WHERE ona.ordem_codigo = fi.ordem_codigo
    AND ona.ordem_codigo = ANY(p_codigos)
    AND ona.data_entrada IS NULL
    AND (
      (fi.tipo_ordem = 'PMPL' AND COALESCE(fi.inicio_programado, fi.data_entrada) IS NOT NULL)
      OR (fi.tipo_ordem <> 'PMPL' AND fi.data_entrada IS NOT NULL)
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.backfill_data_entrada_from_financeiro(text[]) IS
  'Preenche data_entrada apenas quando nula. PMOS usa data_entrada; PMPL usa COALESCE(inicio_programado, data_entrada).';

CREATE OR REPLACE FUNCTION public.listar_gestao_ordens_base_filtrada(
  p_ano integer DEFAULT NULL,
  p_mes integer DEFAULT NULL,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ordem_id uuid,
  ordem_codigo text,
  tipo_ordem text,
  competencia_data date,
  ano integer,
  mes integer,
  nome_loja text,
  tipo_unidade text,
  texto_breve text,
  status_ordem_raw text,
  nota_referencia text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_period_start date;
  v_period_end date;
  v_tipo_ordem_norm text;
BEGIN
  v_tipo_ordem_norm := NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '');

  IF p_ano IS NOT NULL THEN
    v_period_start := make_date(p_ano, COALESCE(p_mes, 1), 1);
    v_period_end := (
      v_period_start
      + CASE
          WHEN p_mes IS NULL THEN INTERVAL '1 year'
          ELSE INTERVAL '1 month'
        END
    )::date;
  END IF;

  RETURN QUERY
  WITH pmos_filtrado AS MATERIALIZED (
    SELECT
      ona.id AS ordem_id,
      BTRIM(ona.ordem_codigo) AS ordem_codigo,
      'PMOS'::text AS tipo_ordem,
      ona.data_entrada::date AS competencia_data,
      EXTRACT(YEAR FROM ona.data_entrada)::int AS ano,
      EXTRACT(MONTH FROM ona.data_entrada)::int AS mes,
      COALESCE(
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        NULLIF(BTRIM(ona.unidade), '')
      ) AS unidade_raw,
      NULLIF(BTRIM(ona.texto_breve), '') AS texto_breve_ona,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS status_ordem_raw,
      ona.nota_id,
      NULLIF(BTRIM(ona.numero_nota), '') AS numero_nota_ona
    FROM public.ordens_notas_acompanhamento ona
    WHERE ona.data_entrada IS NOT NULL
      AND UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), 'PMOS')) <> 'PMPL'
      AND (
        v_period_start IS NULL
        OR (
          ona.data_entrada >= v_period_start
          AND ona.data_entrada < v_period_end
        )
      )
      AND (
        v_tipo_ordem_norm IS NULL
        OR v_tipo_ordem_norm = 'PMOS'
      )
  ),
  pmos_base AS (
    SELECT
      pf.ordem_id,
      pf.ordem_codigo,
      pf.tipo_ordem,
      pf.competencia_data,
      pf.ano,
      pf.mes,
      COALESCE(norm.nome_canonical, pf.unidade_raw) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN pf.unidade_raw IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      COALESCE(
        pf.texto_breve_ona,
        NULLIF(BTRIM(n.descricao), '')
      ) AS texto_breve,
      pf.status_ordem_raw,
      COALESCE(
        pf.nota_id::text,
        pf.numero_nota_ona,
        NULLIF(BTRIM(n.numero_nota), '')
      ) AS nota_referencia
    FROM pmos_filtrado pf
    LEFT JOIN public.notas_manutencao n
      ON n.id = pf.nota_id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = pf.unidade_raw
  ),
  pmpl_filtrado AS MATERIALIZED (
    SELECT
      ona.id AS ordem_id,
      BTRIM(ona.ordem_codigo) AS ordem_codigo,
      'PMPL'::text AS tipo_ordem,
      COALESCE(f.inicio_programado, f.data_entrada)::date AS competencia_data,
      EXTRACT(YEAR FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS ano,
      EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS mes,
      COALESCE(
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        NULLIF(BTRIM(ona.unidade), '')
      ) AS unidade_raw,
      NULLIF(BTRIM(ona.texto_breve), '') AS texto_breve_ona,
      NULLIF(BTRIM(f.texto_breve), '') AS texto_breve_financeiro,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS status_ordem_raw,
      ona.nota_id,
      NULLIF(BTRIM(ona.numero_nota), '') AS numero_nota_ona,
      NULLIF(BTRIM(f.numero_nota), '') AS numero_nota_financeiro
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    WHERE UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), '')) = 'PMPL'
      AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
      AND (
        v_period_start IS NULL
        OR (
          COALESCE(f.inicio_programado, f.data_entrada) >= v_period_start
          AND COALESCE(f.inicio_programado, f.data_entrada) < v_period_end
        )
      )
      AND (
        v_tipo_ordem_norm IS NULL
        OR v_tipo_ordem_norm = 'PMPL'
      )
  ),
  pmpl_base AS (
    SELECT
      pf.ordem_id,
      pf.ordem_codigo,
      pf.tipo_ordem,
      pf.competencia_data,
      pf.ano,
      pf.mes,
      COALESCE(norm.nome_canonical, pf.unidade_raw) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN pf.unidade_raw IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      COALESCE(
        pf.texto_breve_financeiro,
        pf.texto_breve_ona,
        NULLIF(BTRIM(n.descricao), '')
      ) AS texto_breve,
      pf.status_ordem_raw,
      COALESCE(
        pf.nota_id::text,
        pf.numero_nota_ona,
        pf.numero_nota_financeiro,
        NULLIF(BTRIM(n.numero_nota), '')
      ) AS nota_referencia
    FROM pmpl_filtrado pf
    LEFT JOIN public.notas_manutencao n
      ON n.id = pf.nota_id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = pf.unidade_raw
  )
  SELECT
    b.ordem_id,
    b.ordem_codigo,
    b.tipo_ordem,
    b.competencia_data,
    b.ano,
    b.mes,
    b.nome_loja,
    b.tipo_unidade,
    b.texto_breve,
    b.status_ordem_raw,
    b.nota_referencia
  FROM pmos_base b
  UNION ALL
  SELECT
    b.ordem_id,
    b.ordem_codigo,
    b.tipo_ordem,
    b.competencia_data,
    b.ano,
    b.mes,
    b.nome_loja,
    b.tipo_unidade,
    b.texto_breve,
    b.status_ordem_raw,
    b.nota_referencia
  FROM pmpl_base b;
END;
$$;

COMMENT ON FUNCTION public.listar_gestao_ordens_base_filtrada(integer, integer, text) IS
  'Base filtrada por competencia efetiva para os graficos de gestao. PMOS usa data_entrada; PMPL usa COALESCE(inicio_programado, data_entrada).';

CREATE OR REPLACE FUNCTION public.listar_gestao_filtros()
RETURNS TABLE(
  tipo_ordem text,
  ano integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT
    base.tipo_ordem,
    base.ano
  FROM (
    SELECT
      'PMOS'::text AS tipo_ordem,
      EXTRACT(YEAR FROM ona.data_entrada)::int AS ano
    FROM public.ordens_notas_acompanhamento ona
    WHERE ona.data_entrada IS NOT NULL
      AND UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), 'PMOS')) <> 'PMPL'

    UNION ALL

    SELECT
      'PMPL'::text AS tipo_ordem,
      EXTRACT(YEAR FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS ano
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    WHERE UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), '')) = 'PMPL'
      AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
  ) base
  WHERE base.ano IS NOT NULL
  ORDER BY base.ano DESC, base.tipo_ordem ASC;
$$;

CREATE OR REPLACE VIEW public.vw_equipamentos_criticos AS
WITH nota_cat AS (
  SELECT DISTINCT n.id AS nota_id, r.especialidade AS categoria
  FROM public.notas_manutencao n
  JOIN public.regras_distribuicao r
    ON UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  WHERE r.especialidade IN ('elevadores', 'refrigeracao')
    AND BTRIM(n.descricao) <> ''
),
pmos_rows AS (
  SELECT
    COALESCE(
      norm.nome_canonical,
      NULLIF(BTRIM(ona.denominacao_unidade), ''),
      ona.unidade
    ) AS nome_loja,
    COALESCE(
      norm.tipo_unidade_override,
      CASE
        WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
          OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
          THEN 'CD'
        WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
          OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
          THEN 'FARMA'
        WHEN ona.unidade IS NOT NULL THEN 'LOJA'
        ELSE NULL
      END
    ) AS tipo_unidade,
    nc.categoria,
    n.descricao AS texto_breve,
    ona.tipo_ordem,
    EXTRACT(YEAR  FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS ano,
    EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS mes,
    COUNT(DISTINCT ona.id) AS total_ordens,
    COUNT(DISTINCT n.id) AS total_notas
  FROM public.notas_manutencao n
  JOIN nota_cat nc ON nc.nota_id = n.id
  JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
  LEFT JOIN public.dim_denominacao_norm norm
    ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
  WHERE BTRIM(n.descricao) <> ''
  GROUP BY
    COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade),
    norm.tipo_unidade_override,
    ona.unidade,
    nc.categoria,
    n.descricao,
    ona.tipo_ordem,
    EXTRACT(YEAR  FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date)),
    EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))
),
pmpl_rows AS (
  SELECT
    COALESCE(
      norm.nome_canonical,
      NULLIF(BTRIM(ona.denominacao_unidade), ''),
      ona.unidade
    ) AS nome_loja,
    COALESCE(
      norm.tipo_unidade_override,
      CASE
        WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
          OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
          THEN 'CD'
        WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
          OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
          THEN 'FARMA'
        WHEN ona.unidade IS NOT NULL THEN 'LOJA'
        ELSE NULL
      END
    ) AS tipo_unidade,
    r.especialidade AS categoria,
    f.texto_breve AS texto_breve,
    'PMPL'::text AS tipo_ordem,
    EXTRACT(YEAR  FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS ano,
    EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS mes,
    COUNT(DISTINCT ona.id) AS total_ordens,
    0 AS total_notas
  FROM public.ordens_notas_acompanhamento ona
  JOIN public.ordens_financeiro_importado f
    ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
  JOIN public.regras_distribuicao r
    ON UPPER(f.texto_breve) LIKE '%' || UPPER(r.palavra_chave) || '%'
  LEFT JOIN public.dim_denominacao_norm norm
    ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
  WHERE ona.tipo_ordem = 'PMPL'
    AND r.especialidade IN ('elevadores', 'refrigeracao')
    AND BTRIM(f.texto_breve) <> ''
    AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
  GROUP BY
    COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade),
    norm.tipo_unidade_override,
    ona.unidade,
    r.especialidade,
    f.texto_breve,
    EXTRACT(YEAR  FROM COALESCE(f.inicio_programado, f.data_entrada)),
    EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))
)
SELECT * FROM pmos_rows
UNION ALL
SELECT * FROM pmpl_rows;

ALTER VIEW public.vw_equipamentos_criticos SET (security_invoker = on);

CREATE OR REPLACE FUNCTION public.calcular_equipamentos_top_lojas(
  p_categoria   TEXT,
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT    DEFAULT NULL
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
    'CANCELADO', 'CONCLUIDO', 'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO', 'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO', 'ABERTA', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA', 'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO', 'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH nota_cat AS (
    SELECT DISTINCT n.id AS nota_id
    FROM public.notas_manutencao n
    JOIN public.regras_distribuicao r
      ON UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    WHERE r.especialidade = p_categoria
      AND BTRIM(n.descricao) <> ''
  ),
  pmos_base AS (
    SELECT
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.notas_manutencao n
    JOIN nota_cat nc ON nc.nota_id = n.id
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(p_tipo_ordem))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) <> 'PMPL')
  ),
  pmpl_base AS (
    SELECT
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja,
      COALESCE(
        norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    JOIN public.regras_distribuicao r
      ON UPPER(f.texto_breve) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE ona.tipo_ordem = 'PMPL'
      AND r.especialidade = p_categoria
      AND BTRIM(f.texto_breve) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
      AND (p_ano IS NULL OR EXTRACT(YEAR  FROM COALESCE(f.inicio_programado, f.data_entrada))::int = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::int = p_mes)
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) = 'PMPL')
  ),
  base AS (
    SELECT * FROM pmos_base
    UNION ALL
    SELECT * FROM pmpl_base
  )
  SELECT
    b.nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER AS em_aberto,
    COUNT(*)::INTEGER AS total_ordens
  FROM base b
  WHERE b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  mes integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  months AS (
    SELECT GENERATE_SERIES(1, 12)::integer AS mes
  ),
  base AS MATERIALIZED (
    SELECT
      v.competencia_ano AS ano,
      v.competencia_mes AS mes,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  ),
  agg AS (
    SELECT
      b.ano,
      b.mes,
      COUNT(*)::integer AS total_ordens,
      SUM(b.valor_realizado)::numeric AS total_gasto,
      SUM(b.valor_realizado)::numeric AS valor_realizado,
      SUM(b.valor_previsto_pendente)::numeric AS valor_previsto_pendente
    FROM base b
    GROUP BY b.ano, b.mes
  )
  SELECT
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.total_gasto, 0::numeric) AS total_gasto,
    COALESCE(a.valor_realizado, 0::numeric) AS valor_realizado,
    COALESCE(a.valor_previsto_pendente, 0::numeric) AS valor_previsto_pendente
  FROM selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  ORDER BY y.ano ASC, m.mes ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_anual(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.ano,
    SUM(m.total_ordens)::integer AS total_ordens,
    SUM(m.total_gasto)::numeric AS total_gasto,
    SUM(m.valor_realizado)::numeric AS valor_realizado,
    SUM(m.valor_previsto_pendente)::numeric AS valor_previsto_pendente
  FROM public.calcular_comparativo_financeiro_mensal(
    p_ano_base,
    p_ano_comparado,
    p_tipo_ordem
  ) m
  GROUP BY m.ano
  ORDER BY m.ano ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_fornecedores_anual(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_ref text,
  fornecedor_codigo text,
  fornecedor_nome text,
  ano integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  base AS MATERIALIZED (
    SELECT
      COALESCE(
        NULLIF(BTRIM(v.fornecedor_codigo), ''),
        '__nome__:' || LOWER(
          REGEXP_REPLACE(
            COALESCE(NULLIF(BTRIM(v.fornecedor_nome), ''), 'Sem fornecedor'),
            '\s+',
            ' ',
            'g'
          )
        )
      ) AS fornecedor_ref,
      NULLIF(BTRIM(v.fornecedor_codigo), '') AS fornecedor_codigo,
      NULLIF(BTRIM(v.fornecedor_nome), '') AS fornecedor_nome,
      v.competencia_ano AS ano,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  )
  SELECT
    b.fornecedor_ref,
    MAX(b.fornecedor_codigo) AS fornecedor_codigo,
    COALESCE(
      MAX(b.fornecedor_nome) FILTER (WHERE b.fornecedor_nome IS NOT NULL),
      'Sem fornecedor'
    ) AS fornecedor_nome,
    b.ano,
    COUNT(*)::integer AS total_ordens,
    SUM(b.valor_realizado)::numeric AS total_gasto,
    SUM(b.valor_realizado)::numeric AS valor_realizado,
    SUM(b.valor_previsto_pendente)::numeric AS valor_previsto_pendente
  FROM base b
  GROUP BY b.fornecedor_ref, b.ano
  ORDER BY b.ano ASC, total_gasto DESC, fornecedor_nome ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comparativo_financeiro_fornecedor_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL,
  p_fornecedor_codigo text DEFAULT NULL
)
RETURNS TABLE(
  fornecedor_ref text,
  fornecedor_codigo text,
  fornecedor_nome text,
  ano integer,
  mes integer,
  total_ordens integer,
  total_gasto numeric,
  valor_realizado numeric,
  valor_previsto_pendente numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH selected_years AS (
    SELECT DISTINCT year_value AS ano
    FROM UNNEST(ARRAY[p_ano_base, p_ano_comparado]) AS year_value
    WHERE year_value IS NOT NULL
  ),
  months AS (
    SELECT GENERATE_SERIES(1, 12)::integer AS mes
  ),
  base AS MATERIALIZED (
    SELECT
      COALESCE(
        NULLIF(BTRIM(v.fornecedor_codigo), ''),
        '__nome__:' || LOWER(
          REGEXP_REPLACE(
            COALESCE(NULLIF(BTRIM(v.fornecedor_nome), ''), 'Sem fornecedor'),
            '\s+',
            ' ',
            'g'
          )
        )
      ) AS fornecedor_ref,
      NULLIF(BTRIM(v.fornecedor_codigo), '') AS fornecedor_codigo,
      NULLIF(BTRIM(v.fornecedor_nome), '') AS fornecedor_nome,
      v.competencia_ano AS ano,
      v.competencia_mes AS mes,
      GREATEST(COALESCE(v.valor_realizado, 0)::numeric, 0::numeric) AS valor_realizado,
      GREATEST(COALESCE(v.valor_previsto_pendente, 0)::numeric, 0::numeric) AS valor_previsto_pendente
    FROM public.vw_financeiro_ordens v
    JOIN selected_years y
      ON y.ano = v.competencia_ano
    WHERE (
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '') IS NULL
      OR v.tipo_ordem = NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), '')
    )
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE p_fornecedor_codigo IS NOT NULL
      AND fornecedor_ref = p_fornecedor_codigo
  ),
  supplier_meta AS (
    SELECT
      MAX(fornecedor_ref) AS fornecedor_ref,
      MAX(fornecedor_codigo) AS fornecedor_codigo,
      COALESCE(
        MAX(fornecedor_nome) FILTER (WHERE fornecedor_nome IS NOT NULL),
        'Sem fornecedor'
      ) AS fornecedor_nome
    FROM filtered
  ),
  agg AS (
    SELECT
      f.ano,
      f.mes,
      COUNT(*)::integer AS total_ordens,
      SUM(f.valor_realizado)::numeric AS total_gasto,
      SUM(f.valor_realizado)::numeric AS valor_realizado,
      SUM(f.valor_previsto_pendente)::numeric AS valor_previsto_pendente
    FROM filtered f
    GROUP BY f.ano, f.mes
  )
  SELECT
    s.fornecedor_ref,
    s.fornecedor_codigo,
    s.fornecedor_nome,
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.total_gasto, 0::numeric) AS total_gasto,
    COALESCE(a.valor_realizado, 0::numeric) AS valor_realizado,
    COALESCE(a.valor_previsto_pendente, 0::numeric) AS valor_previsto_pendente
  FROM supplier_meta s
  CROSS JOIN selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  WHERE s.fornecedor_ref IS NOT NULL
  ORDER BY y.ano ASC, m.mes ASC;
$$;
