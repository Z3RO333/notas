-- 00150_equipamentos_pmpl_via_financeiro.sql
--
-- Corrige categorização PMPL em vw_equipamentos_criticos e calcular_equipamentos_top_lojas.
--
-- Problema: a view categorizava por palavra-chave na descricao da nota (notas_manutencao),
-- mas ordens PMPL (elevador, escada, gerador) têm descrição genérica na nota.
-- O texto específico do equipamento está em ordens_financeiro_importado.texto_breve.
--
-- Fix: adiciona CTE pmpl_cat que usa ordens_financeiro_importado.texto_breve
-- para categorizar ordens PMPL; UNION com nota_cat existente.
-- Também usa financeiro.texto_breve como label dos serviços para PMPL.

-- ---------------------------------------------------------------------------
-- vw_equipamentos_criticos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_equipamentos_criticos AS
WITH nota_cat AS (
  -- Categorização existente: por descricao da nota (funciona bem para PMOS)
  SELECT DISTINCT n.id AS nota_id, r.especialidade AS categoria
  FROM public.notas_manutencao n
  JOIN public.regras_distribuicao r
    ON UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  WHERE r.especialidade IN ('elevadores', 'refrigeracao')
    AND BTRIM(n.descricao) <> ''
),
pmpl_cat AS (
  -- Categorização PMPL: por texto_breve da tabela financeira (tem o equipamento correto)
  SELECT DISTINCT ona.nota_id, r.especialidade AS categoria
  FROM public.ordens_notas_acompanhamento ona
  JOIN public.ordens_financeiro_importado f
    ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
  JOIN public.regras_distribuicao r
    ON UPPER(f.texto_breve) LIKE '%' || UPPER(r.palavra_chave) || '%'
  WHERE ona.tipo_ordem = 'PMPL'
    AND r.especialidade IN ('elevadores', 'refrigeracao')
    AND BTRIM(f.texto_breve) <> ''
),
combined_cat AS (
  SELECT nota_id, categoria FROM nota_cat
  UNION
  SELECT nota_id, categoria FROM pmpl_cat
)
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
  -- PMPL: usa texto_breve do financeiro (tem o equipamento); PMOS: usa descricao da nota
  COALESCE(f.texto_breve, n.descricao)                                         AS texto_breve,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS ano,
  EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date))::int AS mes,
  COUNT(DISTINCT ona.id)                                                        AS total_ordens,
  COUNT(DISTINCT n.id)                                                          AS total_notas
FROM public.notas_manutencao n
JOIN combined_cat nc ON nc.nota_id = n.id
JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
LEFT JOIN public.dim_denominacao_norm norm
  ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
LEFT JOIN public.ordens_financeiro_importado f
  ON ona.tipo_ordem = 'PMPL' AND BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
WHERE BTRIM(n.descricao) <> ''
GROUP BY
  COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade),
  norm.tipo_unidade_override,
  ona.unidade,
  nc.categoria,
  COALESCE(f.texto_breve, n.descricao),
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date)),
  EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date));

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
  pmpl_cat AS (
    SELECT DISTINCT ona.nota_id
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    JOIN public.regras_distribuicao r
      ON UPPER(f.texto_breve) LIKE '%' || UPPER(r.palavra_chave) || '%'
    WHERE ona.tipo_ordem = 'PMPL'
      AND r.especialidade = p_categoria
      AND BTRIM(f.texto_breve) <> ''
  ),
  combined_cat AS (
    SELECT nota_id FROM nota_cat
    UNION
    SELECT nota_id FROM pmpl_cat
  ),
  base AS (
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
    JOIN combined_cat nc ON nc.nota_id = n.id
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
