-- 00139_fix_equipamentos.sql
-- 1) Remove filtro PMOS-only da view e RPC (inclui PMPL também para elevadores)
-- 2) Cria RPC buscar_ordens_equipamento para drill-down filtrado por categoria

-- ---------------------------------------------------------------------------
-- Atualiza view: remove filtro tipo_ordem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_equipamentos_criticos AS
WITH nota_cat AS (
  SELECT DISTINCT n.id AS nota_id, r.especialidade AS categoria
  FROM public.notas_manutencao n
  JOIN public.regras_distribuicao r
    ON UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
  WHERE r.especialidade IN ('elevadores', 'refrigeracao')
    AND BTRIM(n.descricao) <> ''
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
  EXTRACT(MONTH FROM COALESCE(ona.data_entrada, n.data_criacao_sap, n.created_at::date));

-- ---------------------------------------------------------------------------
-- Atualiza RPC calcular_equipamentos_top_lojas: remove filtro tipo_ordem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_equipamentos_top_lojas(
  p_categoria  TEXT,
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL
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

-- ---------------------------------------------------------------------------
-- Nova RPC: buscar_ordens_equipamento
-- Drill-down filtrado por loja + categoria (keyword matching)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_ordens_equipamento(
  p_nome_loja  TEXT,
  p_categoria  TEXT,
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  ordem_codigo     TEXT,
  status_ordem_raw TEXT,
  data_entrada     DATE,
  tipo_ordem       TEXT,
  descricao        TEXT,
  centro           TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ona.id,
    ona.ordem_codigo,
    ona.status_ordem_raw,
    ona.data_entrada,
    ona.tipo_ordem,
    n.descricao,
    n.centro
  FROM public.ordens_notas_acompanhamento ona
  JOIN public.notas_manutencao n ON n.id = ona.nota_id
  WHERE
    -- Filtra pela loja (nome canônico ou denominacao normalizada)
    COALESCE(
      (SELECT d.nome_canonical FROM public.dim_denominacao_norm d
       WHERE d.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade),''), ona.unidade)
       LIMIT 1),
      NULLIF(BTRIM(ona.denominacao_unidade),''),
      ona.unidade
    ) = p_nome_loja
    -- Filtra pela categoria: nota deve conter keyword da especialidade
    AND EXISTS (
      SELECT 1 FROM public.regras_distribuicao r
      WHERE r.especialidade = p_categoria
        AND UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    )
    AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR  FROM ona.data_entrada)::int = p_ano))
    AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::int = p_mes))
  ORDER BY ona.data_entrada DESC NULLS LAST
  LIMIT 200;
END;
$$;
