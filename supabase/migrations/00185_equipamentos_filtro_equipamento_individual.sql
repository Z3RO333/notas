-- 00185_equipamentos_filtro_equipamento_individual.sql
--
-- Adiciona filtro individual por tipo de equipamento na pagina de
-- equipamentos, cobrindo ranking por loja, evolucao, lista de anos,
-- opcoes de filtro e drill-down de ordens.

CREATE OR REPLACE FUNCTION public.normalizar_texto_equipamento_critico(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT BTRIM(
    REGEXP_REPLACE(
      TRANSLATE(
        UPPER(COALESCE(p_texto, '')),
        'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ-/',
        'AAAAAEEEEIIIIOOOOOUUUUC  '
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.classificar_equipamento_critico(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT public.normalizar_texto_equipamento_critico(p_texto) AS texto
  )
  SELECT CASE
    WHEN texto = '' THEN NULL
    WHEN texto LIKE '%ESCADA ROLANTE%' THEN 'ESCADA ROLANTE'
    WHEN texto LIKE '%GRUPO GERADOR%' OR texto LIKE '%GERADOR%' THEN 'GERADOR'
    WHEN texto LIKE '%MONTA CARGA%' THEN 'MONTA CARGA'
    WHEN texto LIKE '%PLATAFORMA%' THEN 'PLATAFORMA'
    WHEN texto LIKE '%SUBESTACAO%' THEN 'SUBESTACAO'
    WHEN texto LIKE '%ELEVADOR%' THEN 'ELEVADOR'
    WHEN texto LIKE '%TERMOMETRO DE GELADEIRA%' THEN 'TERMOMETRO DE GELADEIRA'
    WHEN texto LIKE '%FREEZER%' THEN 'FREEZER'
    WHEN texto LIKE '%CHILLER%' THEN 'CHILLER'
    WHEN texto LIKE '%VRF%' THEN 'VRF'
    WHEN texto LIKE '%SPLITAO%' THEN 'SPLITAO'
    WHEN texto LIKE '%AR CONDICIONADO%'
      OR texto LIKE '%AR COND%'
      OR texto LIKE '%CENTRAL DE AR%'
      OR texto LIKE '%CENTRAIS DE AR%'
      THEN 'AR CONDICIONADO'
    WHEN texto LIKE '%REFRIGERACAO%' THEN 'REFRIGERACAO'
    ELSE NULL
  END
  FROM normalized;
$$;

DROP FUNCTION IF EXISTS public.calcular_equipamentos_top_lojas(TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.calcular_equipamentos_top_lojas(TEXT, INTEGER, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.calcular_equipamentos_top_lojas(
  p_categoria    TEXT,
  p_ano          INTEGER DEFAULT NULL,
  p_mes          INTEGER DEFAULT NULL,
  p_tipo_ordem   TEXT    DEFAULT NULL,
  p_equipamento  TEXT    DEFAULT NULL
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
  v_equipamento_filtro TEXT := NULLIF(BTRIM(public.classificar_equipamento_critico(p_equipamento)), '');
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
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm,
      public.classificar_equipamento_critico(n.descricao) AS equipamento
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
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem)))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) <> 'PMPL')
      AND (v_equipamento_filtro IS NULL OR public.classificar_equipamento_critico(n.descricao) = v_equipamento_filtro)
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
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE '% CD'
            THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)) LIKE 'BEMOL FARMA %'
            THEN 'FARMA'
          WHEN ona.unidade IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm,
      public.classificar_equipamento_critico(f.texto_breve) AS equipamento
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
      AND (p_ano IS NULL OR EXTRACT(YEAR FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_mes)
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) = 'PMPL')
      AND (v_equipamento_filtro IS NULL OR public.classificar_equipamento_critico(f.texto_breve) = v_equipamento_filtro)
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

DROP FUNCTION IF EXISTS public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.buscar_equipamentos_criticos_linhas(
  p_categoria    TEXT,
  p_ano          INTEGER DEFAULT NULL,
  p_mes          INTEGER DEFAULT NULL,
  p_tipo_ordem   TEXT DEFAULT NULL,
  p_equipamento  TEXT DEFAULT NULL
)
RETURNS TABLE(
  texto_breve  TEXT,
  nome_loja    TEXT,
  ano          INTEGER,
  mes          INTEGER,
  total_ordens BIGINT,
  total_notas  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_equipamento_filtro TEXT := NULLIF(BTRIM(public.classificar_equipamento_critico(p_equipamento)), '');
BEGIN
  RETURN QUERY
  SELECT
    NULLIF(BTRIM(v.texto_breve), '') AS texto_breve,
    v.nome_loja,
    v.ano,
    v.mes,
    v.total_ordens,
    v.total_notas
  FROM public.vw_equipamentos_criticos v
  WHERE v.categoria = p_categoria
    AND v.nome_loja IS NOT NULL
    AND BTRIM(v.nome_loja) <> ''
    AND NULLIF(BTRIM(v.texto_breve), '') IS NOT NULL
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (p_mes IS NULL OR v.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
    AND (
      v_equipamento_filtro IS NULL
      OR public.classificar_equipamento_critico(v.texto_breve) = v_equipamento_filtro
    )
  ORDER BY v.total_ordens DESC, v.nome_loja ASC, v.texto_breve ASC
  LIMIT 5000;
END;
$$;

DROP FUNCTION IF EXISTS public.listar_equipamentos_criticos_anos(TEXT);
DROP FUNCTION IF EXISTS public.listar_equipamentos_criticos_anos(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.listar_equipamentos_criticos_anos(
  p_tipo_ordem   TEXT DEFAULT NULL,
  p_equipamento  TEXT DEFAULT NULL
)
RETURNS TABLE(
  ano INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_equipamento_filtro TEXT := NULLIF(BTRIM(public.classificar_equipamento_critico(p_equipamento)), '');
BEGIN
  RETURN QUERY
  SELECT DISTINCT v.ano
  FROM public.vw_equipamentos_criticos v
  WHERE v.ano IS NOT NULL
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
    AND (
      v_equipamento_filtro IS NULL
      OR public.classificar_equipamento_critico(v.texto_breve) = v_equipamento_filtro
    )
  ORDER BY v.ano DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.listar_equipamentos_criticos_filtros(
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL
)
RETURNS TABLE(
  equipamento   TEXT,
  total_ordens  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.classificar_equipamento_critico(v.texto_breve) AS equipamento,
    SUM(v.total_ordens)::BIGINT AS total_ordens
  FROM public.vw_equipamentos_criticos v
  WHERE NULLIF(BTRIM(v.texto_breve), '') IS NOT NULL
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (p_mes IS NULL OR v.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  GROUP BY public.classificar_equipamento_critico(v.texto_breve)
  HAVING public.classificar_equipamento_critico(v.texto_breve) IS NOT NULL
  ORDER BY total_ordens DESC, equipamento ASC;
$$;

DROP FUNCTION IF EXISTS public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.buscar_ordens_equipamento(
  p_nome_loja     TEXT,
  p_categoria     TEXT,
  p_ano           INTEGER DEFAULT NULL,
  p_mes           INTEGER DEFAULT NULL,
  p_tipo_ordem    TEXT    DEFAULT NULL,
  p_equipamento   TEXT    DEFAULT NULL
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
  WITH filtro AS (
    SELECT NULLIF(BTRIM(public.classificar_equipamento_critico(p_equipamento)), '') AS equipamento
  ),
  nota_cat AS (
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
    CROSS JOIN filtro f0
    WHERE BTRIM(n.descricao) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(YEAR FROM ona.data_entrada)::INT = p_ano))
      AND (p_mes IS NULL OR (ona.data_entrada IS NOT NULL AND EXTRACT(MONTH FROM ona.data_entrada)::INT = p_mes))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem)))
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) <> 'PMPL')
      AND (f0.equipamento IS NULL OR public.classificar_equipamento_critico(n.descricao) = f0.equipamento)
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
    CROSS JOIN filtro f0
    WHERE ona.tipo_ordem = 'PMPL'
      AND r.especialidade = p_categoria
      AND BTRIM(f.texto_breve) <> ''
      AND ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
      AND (p_ano IS NULL OR EXTRACT(YEAR FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::INT = p_mes)
      AND (p_tipo_ordem IS NULL OR UPPER(BTRIM(p_tipo_ordem)) = 'PMPL')
      AND (f0.equipamento IS NULL OR public.classificar_equipamento_critico(f.texto_breve) = f0.equipamento)
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

COMMENT ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT, TEXT) IS
  'Linhas agregadas da pagina de equipamentos com filtro opcional por equipamento individual.';
COMMENT ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT, TEXT) IS
  'Lista anos disponiveis para a pagina de equipamentos, com filtro opcional por equipamento individual.';
COMMENT ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) IS
  'Lista os tipos canonicos de equipamento disponiveis na pagina de equipamentos para o recorte informado.';

REVOKE ALL ON FUNCTION public.calcular_equipamentos_top_lojas(TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calcular_equipamentos_top_lojas(TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_equipamentos_criticos_filtros(INTEGER, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_ordens_equipamento(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
