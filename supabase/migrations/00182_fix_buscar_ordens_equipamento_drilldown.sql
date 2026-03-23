-- Alinha o drill-down de Equipamentos com a mesma regra usada no ranking
-- de top lojas, incluindo PMPL via ordens_financeiro_importado e filtro
-- opcional por tipo de ordem.

DROP FUNCTION IF EXISTS public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.buscar_ordens_equipamento(
  p_nome_loja   TEXT,
  p_categoria   TEXT,
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT    DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  ordem_codigo     TEXT,
  status_ordem_raw TEXT,
  data_entrada     TIMESTAMPTZ,
  tipo_ordem       TEXT,
  descricao        TEXT,
  centro           TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
      ona.id,
      ona.ordem_codigo,
      ona.status_ordem_raw,
      ona.data_entrada,
      ona.tipo_ordem,
      n.descricao,
      n.centro,
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja
    FROM public.notas_manutencao n
    JOIN nota_cat nc ON nc.nota_id = n.id
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    LEFT JOIN public.dim_denominacao_norm norm
      ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
    WHERE BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR FROM ona.data_entrada)::INT = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::INT = p_mes))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(p_tipo_ordem))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) <> 'PMPL')
  ),
  pmpl_base AS (
    SELECT
      ona.id,
      ona.ordem_codigo,
      ona.status_ordem_raw,
      COALESCE(f.inicio_programado, f.data_entrada) AS data_entrada,
      ona.tipo_ordem,
      f.texto_breve AS descricao,
      COALESCE(NULLIF(BTRIM(ona.centro), ''), n.centro) AS centro,
      COALESCE(
        norm.nome_canonical,
        NULLIF(BTRIM(ona.denominacao_unidade), ''),
        ona.unidade
      ) AS nome_loja
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    LEFT JOIN public.notas_manutencao n ON n.id = ona.nota_id
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
      AND (p_ano IS NULL OR EXTRACT(YEAR FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_mes)
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) = 'PMPL')
  ),
  base AS (
    SELECT * FROM pmos_base
    UNION ALL
    SELECT * FROM pmpl_base
  )
  SELECT
    b.id,
    b.ordem_codigo,
    b.status_ordem_raw,
    b.data_entrada,
    b.tipo_ordem,
    b.descricao,
    b.centro
  FROM base b
  WHERE b.nome_loja = p_nome_loja
  ORDER BY b.data_entrada DESC NULLS LAST
  LIMIT 200;
$$;
