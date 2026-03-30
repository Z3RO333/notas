-- 00203_excluir_loja_shopping_millennium_gestao.sql
--
-- Shopping Millennium e uma loja encerrada e nao deve mais aparecer nem contar
-- nos graficos gerenciais. Em vez de espalhar filtros por nome em cada RPC,
-- marcamos a unidade como excluida na dimensao canonica e fazemos a base
-- gerencial respeitar essa flag.

-- ---------------------------------------------------------------------------
-- 1. Dimensao de normalizacao: flag para exclusao do recorte gerencial
-- ---------------------------------------------------------------------------
ALTER TABLE public.dim_denominacao_norm
  ADD COLUMN IF NOT EXISTS inclui_gestao BOOLEAN;

UPDATE public.dim_denominacao_norm
SET inclui_gestao = TRUE
WHERE inclui_gestao IS NULL;

ALTER TABLE public.dim_denominacao_norm
  ALTER COLUMN inclui_gestao SET DEFAULT TRUE;

ALTER TABLE public.dim_denominacao_norm
  ALTER COLUMN inclui_gestao SET NOT NULL;

COMMENT ON COLUMN public.dim_denominacao_norm.inclui_gestao IS
  'Quando FALSE, a unidade e excluida da base e dos KPIs gerenciais.';

INSERT INTO public.dim_denominacao_norm (
  raw_nome,
  nome_canonical,
  tipo_unidade_override,
  inclui_gestao
)
VALUES
  ('SHOPPING MILLENNIUM',         'Loja Shopping Millennium', 'LOJA', FALSE),
  ('Loja Shopping Millennium',    'Loja Shopping Millennium', 'LOJA', FALSE),
  ('SHOPPING MILLENIUM',          'Loja Shopping Millennium', 'LOJA', FALSE),
  ('Loja Shopping Millenium',     'Loja Shopping Millennium', 'LOJA', FALSE)
ON CONFLICT (raw_nome) DO UPDATE
  SET nome_canonical        = EXCLUDED.nome_canonical,
      tipo_unidade_override = EXCLUDED.tipo_unidade_override,
      inclui_gestao         = EXCLUDED.inclui_gestao;

-- ---------------------------------------------------------------------------
-- 2. Base gerencial canonica: respeita a exclusao na dimensao
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_gestao_ordens_base_filtrada(
  p_ano          integer DEFAULT NULL,
  p_mes          integer DEFAULT NULL,
  p_tipo_ordem   text    DEFAULT NULL,
  p_texto_breve  text    DEFAULT NULL,
  p_tipo_unidade text    DEFAULT NULL,
  p_limit        integer DEFAULT NULL,
  p_nome_loja    text    DEFAULT NULL
)
RETURNS TABLE(
  ordem_id        uuid,
  ordem_codigo    text,
  tipo_ordem      text,
  competencia_data date,
  ano             integer,
  mes             integer,
  nome_loja       text,
  tipo_unidade    text,
  texto_breve     text,
  status_ordem_raw text,
  nota_referencia text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_period_start      date;
  v_period_end        date;
  v_tipo_ordem_norm   text;
  v_texto_breve_norm  text;
  v_tipo_unidade_norm text;
  v_nome_loja_norm    text;
BEGIN
  v_tipo_ordem_norm   := NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem,   ''))), '');
  v_texto_breve_norm  := NULLIF(BTRIM(COALESCE(p_texto_breve,  '')), '');
  v_tipo_unidade_norm := NULLIF(UPPER(BTRIM(COALESCE(p_tipo_unidade, ''))), '');
  v_nome_loja_norm    := NULLIF(BTRIM(COALESCE(p_nome_loja,    '')), '');

  IF p_ano IS NOT NULL THEN
    v_period_start := make_date(p_ano, COALESCE(p_mes, 1), 1);
    v_period_end   := (v_period_start + CASE WHEN p_mes IS NULL THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)::date;
  END IF;

  RETURN QUERY
  WITH pmos_filtrado AS MATERIALIZED (
    SELECT
      ona.id                                                       AS ordem_id,
      BTRIM(ona.ordem_codigo)                                      AS ordem_codigo,
      'PMOS'::text                                                 AS tipo_ordem,
      ona.data_entrada::date                                       AS competencia_data,
      EXTRACT(YEAR  FROM ona.data_entrada)::int                    AS ano,
      EXTRACT(MONTH FROM ona.data_entrada)::int                    AS mes,
      COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), NULLIF(BTRIM(ona.unidade), '')) AS unidade_raw,
      NULLIF(BTRIM(ona.texto_breve), '')                           AS texto_breve_ona,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, '')))             AS status_ordem_raw,
      ona.nota_id,
      NULLIF(BTRIM(ona.numero_nota), '')                           AS numero_nota_ona
    FROM public.ordens_notas_acompanhamento ona
    WHERE ona.data_entrada IS NOT NULL
      AND UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), 'PMOS')) <> 'PMPL'
      AND (v_period_start IS NULL OR (ona.data_entrada >= v_period_start AND ona.data_entrada < v_period_end))
      AND (v_tipo_ordem_norm IS NULL OR v_tipo_ordem_norm = 'PMOS')
      AND (v_texto_breve_norm IS NULL OR BTRIM(ona.texto_breve) = v_texto_breve_norm)
  ),
  pmos_base AS (
    SELECT
      pf.ordem_id, pf.ordem_codigo, pf.tipo_ordem, pf.competencia_data, pf.ano, pf.mes,
      COALESCE(norm.nome_canonical, pf.unidade_raw) AS nome_loja,
      COALESCE(norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE '% CD'  THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'BEMOL FARMA %' THEN 'FARMA'
          WHEN pf.unidade_raw IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      COALESCE(pf.texto_breve_ona, NULLIF(BTRIM(n.descricao), '')) AS texto_breve,
      pf.status_ordem_raw,
      COALESCE(pf.nota_id::text, pf.numero_nota_ona, NULLIF(BTRIM(n.numero_nota), '')) AS nota_referencia
    FROM pmos_filtrado pf
    LEFT JOIN public.notas_manutencao n ON n.id = pf.nota_id
    LEFT JOIN public.dim_denominacao_norm norm ON norm.raw_nome = pf.unidade_raw
    WHERE COALESCE(norm.inclui_gestao, TRUE)
  ),
  pmpl_filtrado AS MATERIALIZED (
    SELECT
      ona.id                                                       AS ordem_id,
      BTRIM(ona.ordem_codigo)                                      AS ordem_codigo,
      'PMPL'::text                                                 AS tipo_ordem,
      COALESCE(f.inicio_programado, f.data_entrada)::date          AS competencia_data,
      EXTRACT(YEAR  FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS ano,
      EXTRACT(MONTH FROM COALESCE(f.inicio_programado, f.data_entrada))::int AS mes,
      COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), NULLIF(BTRIM(ona.unidade), '')) AS unidade_raw,
      NULLIF(BTRIM(ona.texto_breve), '')                           AS texto_breve_ona,
      NULLIF(BTRIM(f.texto_breve), '')                             AS texto_breve_financeiro,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, '')))             AS status_ordem_raw,
      ona.nota_id,
      NULLIF(BTRIM(ona.numero_nota), '')                           AS numero_nota_ona,
      NULLIF(BTRIM(f.numero_nota), '')                             AS numero_nota_financeiro
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    WHERE UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), '')) = 'PMPL'
      AND COALESCE(f.inicio_programado, f.data_entrada) IS NOT NULL
      AND (v_period_start IS NULL OR (COALESCE(f.inicio_programado, f.data_entrada) >= v_period_start AND COALESCE(f.inicio_programado, f.data_entrada) < v_period_end))
      AND (v_tipo_ordem_norm IS NULL OR v_tipo_ordem_norm = 'PMPL')
      AND (v_texto_breve_norm IS NULL OR BTRIM(COALESCE(ona.texto_breve, f.texto_breve)) = v_texto_breve_norm)
  ),
  pmpl_base AS (
    SELECT
      pf.ordem_id, pf.ordem_codigo, pf.tipo_ordem, pf.competencia_data, pf.ano, pf.mes,
      COALESCE(norm.nome_canonical, pf.unidade_raw) AS nome_loja,
      COALESCE(norm.tipo_unidade_override,
        CASE
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'CD %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE '% CD'  THEN 'CD'
          WHEN UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'FARMA %'
            OR UPPER(COALESCE(norm.nome_canonical, pf.unidade_raw)) LIKE 'BEMOL FARMA %' THEN 'FARMA'
          WHEN pf.unidade_raw IS NOT NULL THEN 'LOJA'
          ELSE NULL
        END
      ) AS tipo_unidade,
      COALESCE(pf.texto_breve_financeiro, pf.texto_breve_ona, NULLIF(BTRIM(n.descricao), '')) AS texto_breve,
      pf.status_ordem_raw,
      COALESCE(pf.nota_id::text, pf.numero_nota_ona, pf.numero_nota_financeiro, NULLIF(BTRIM(n.numero_nota), '')) AS nota_referencia
    FROM pmpl_filtrado pf
    LEFT JOIN public.notas_manutencao n ON n.id = pf.nota_id
    LEFT JOIN public.dim_denominacao_norm norm ON norm.raw_nome = pf.unidade_raw
    WHERE COALESCE(norm.inclui_gestao, TRUE)
  ),
  combined AS (
    SELECT b.ordem_id, b.ordem_codigo, b.tipo_ordem, b.competencia_data, b.ano, b.mes,
           b.nome_loja, b.tipo_unidade, b.texto_breve, b.status_ordem_raw, b.nota_referencia
    FROM pmos_base b
    UNION ALL
    SELECT b.ordem_id, b.ordem_codigo, b.tipo_ordem, b.competencia_data, b.ano, b.mes,
           b.nome_loja, b.tipo_unidade, b.texto_breve, b.status_ordem_raw, b.nota_referencia
    FROM pmpl_base b
  )
  SELECT c.*
  FROM combined c
  WHERE (v_tipo_unidade_norm IS NULL OR UPPER(c.tipo_unidade) = v_tipo_unidade_norm)
    AND (v_nome_loja_norm IS NULL OR c.nome_loja = v_nome_loja_norm)
  ORDER BY c.competencia_data DESC NULLS LAST, c.ordem_codigo
  LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE GREATEST(1, LEAST(p_limit, 500)) END;
END;
$$;
