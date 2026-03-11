-- 00151_equipamentos_pmpl_direto.sql
--
-- Root cause: ordens_notas_acompanhamento.nota_id é NULL para ordens PMPL.
-- Portanto o JOIN com notas_manutencao não encontra nada para PMPL.
--
-- Fix: UNION ALL com path direto ONA + ordens_financeiro_importado para PMPL,
-- sem passar por notas_manutencao.

-- ---------------------------------------------------------------------------
-- vw_equipamentos_criticos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_equipamentos_criticos AS
WITH nota_cat AS (
  -- PMOS: categorização por descricao da nota
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
    )                                                                             AS nome_loja,
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
    )                                                                             AS tipo_unidade,
    nc.categoria,
    n.descricao                                                                   AS texto_breve,
    ona.tipo_ordem,
    EXTRACT(YEAR  FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS ano,
    EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS mes,
    COUNT(DISTINCT ona.id)                                                        AS total_ordens,
    COUNT(DISTINCT n.id)                                                          AS total_notas
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
  -- PMPL direto: nota_id é NULL, usa financeiro para texto_breve e categoria
  SELECT
    COALESCE(
      norm.nome_canonical,
      NULLIF(BTRIM(ona.denominacao_unidade), ''),
      ona.unidade
    )                                                                             AS nome_loja,
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
    )                                                                             AS tipo_unidade,
    r.especialidade                                                               AS categoria,
    f.texto_breve                                                                 AS texto_breve,
    'PMPL'::text                                                                  AS tipo_ordem,
    EXTRACT(YEAR  FROM f.data_entrada)::int                                       AS ano,
    EXTRACT(MONTH FROM f.data_entrada)::int                                       AS mes,
    COUNT(DISTINCT ona.id)                                                        AS total_ordens,
    0                                                                             AS total_notas
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
    AND f.data_entrada IS NOT NULL
  GROUP BY
    COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade),
    norm.tipo_unidade_override,
    ona.unidade,
    r.especialidade,
    f.texto_breve,
    EXTRACT(YEAR  FROM f.data_entrada),
    EXTRACT(MONTH FROM f.data_entrada)
)
SELECT * FROM pmos_rows
UNION ALL
SELECT * FROM pmpl_rows;

-- ---------------------------------------------------------------------------
-- calcular_equipamentos_top_lojas
-- ---------------------------------------------------------------------------
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
    -- Ordens com nota (PMOS e afins)
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
    WHERE
      BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(p_tipo_ordem))
  ),
  pmpl_base AS (
    -- PMPL direto: sem nota, categorização via financeiro
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
    WHERE
      ona.tipo_ordem = 'PMPL'
      AND r.especialidade = p_categoria
      AND BTRIM(f.texto_breve) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (f.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM f.data_entrada)::int = p_ano))
      AND (p_mes IS NULL OR (f.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM f.data_entrada)::int = p_mes))
      -- Inclui PMPL path só quando filtro é NULL ou 'PMPL'
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
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto,
    COUNT(*)::INTEGER                                                       AS total_ordens
  FROM base b
  WHERE b.tipo_unidade IS NOT NULL AND b.nome_loja IS NOT NULL AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;
