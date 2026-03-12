-- 00157_optimize_graficos_gestao_rpcs.sql
--
-- Corrige timeout das RPCs de graficos de gestao.
-- A view por ordem ficou correta semanticamente, mas algumas RPCs passaram a
-- varrer toda a base antes de aplicar os filtros de ano/mes/tipo, causando
-- statement timeout e cards vazios no frontend.
--
-- Estrategia:
-- 1) adicionar indices de apoio para periodo e join por ordem_codigo normalizado
-- 2) criar uma funcao base filtrada por parametros, com pushdown de periodo
-- 3) reescrever as RPCs para agrupar sobre essa base filtrada

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_ordem_codigo_btrim
  ON public.ordens_notas_acompanhamento ((BTRIM(ordem_codigo)));

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_ordem_codigo_btrim
  ON public.ordens_financeiro_importado ((BTRIM(ordem_codigo)));

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_tipo_data_entrada_gestao
  ON public.ordens_notas_acompanhamento (tipo_ordem, data_entrada)
  WHERE data_entrada IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_financeiro_importado_tipo_inicio_programado_gestao
  ON public.ordens_financeiro_importado (tipo_ordem, inicio_programado)
  WHERE inicio_programado IS NOT NULL;

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
      f.inicio_programado::date AS competencia_data,
      EXTRACT(YEAR FROM f.inicio_programado)::int AS ano,
      EXTRACT(MONTH FROM f.inicio_programado)::int AS mes,
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
      AND f.inicio_programado IS NOT NULL
      AND (
        v_period_start IS NULL
        OR (
          f.inicio_programado >= v_period_start
          AND f.inicio_programado < v_period_end
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
  'Base filtrada por data da ordem para os graficos de gestao. PMOS usa data_entrada; PMPL usa inicio_programado.';

CREATE OR REPLACE FUNCTION public.calcular_gestao_top_lojas_por_status(
  p_ano integer DEFAULT NULL,
  p_mes integer DEFAULT NULL,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  nome_loja text,
  tipo_unidade text,
  concluidas integer,
  em_aberto integer,
  total_ordens integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    b.nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (
      WHERE b.status_ordem_raw = ANY(ARRAY[
        'CANCELADO',
        'CONCLUIDO',
        'AGUARDANDO_FATURAMENTO_NF',
        'EXECUCAO_SATISFATORIO',
        'EXECUCAO_SATISFATORIA',
        'AVALIACAO_DA_EXECUCAO',
        'AVALIACAO_DE_EXECUCAO'
      ]::text[])
    )::integer AS concluidas,
    COUNT(*) FILTER (
      WHERE b.status_ordem_raw = ANY(ARRAY[
        'ABERTO',
        'ABERTA',
        'EM_EXECUCAO',
        'EQUIPAMENTO_EM_CONSERTO',
        'EXECUCAO_NAO_REALIZADA',
        'ENVIAR_EMAIL_PFORNECEDOR',
        'EM_PROCESSAMENTO',
        'EXECUCAO_INSATISFATORIO'
      ]::text[])
    )::integer AS em_aberto,
    COUNT(*)::integer AS total_ordens
  FROM public.listar_gestao_ordens_base_filtrada(p_ano, p_mes, p_tipo_ordem) b
  WHERE b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
  GROUP BY b.nome_loja, b.tipo_unidade
  ORDER BY total_ordens DESC, b.nome_loja ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_gestao_top_servicos(
  p_ano integer DEFAULT NULL,
  p_mes integer DEFAULT NULL,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  texto_breve text,
  tipo_unidade text,
  total_ordens integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    b.texto_breve,
    b.tipo_unidade,
    COUNT(*)::integer AS total_ordens
  FROM public.listar_gestao_ordens_base_filtrada(p_ano, p_mes, p_tipo_ordem) b
  WHERE b.tipo_unidade IS NOT NULL
    AND BTRIM(COALESCE(b.texto_breve, '')) <> ''
  GROUP BY b.texto_breve, b.tipo_unidade
  ORDER BY total_ordens DESC, b.texto_breve ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_gestao_evolucao_mensal(
  p_ano integer DEFAULT NULL,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  mes integer,
  tipo_unidade text,
  total_ordens integer,
  total_notas integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    b.ano,
    b.mes,
    b.tipo_unidade,
    COUNT(*)::integer AS total_ordens,
    COUNT(DISTINCT b.nota_referencia)::integer AS total_notas
  FROM public.listar_gestao_ordens_base_filtrada(p_ano, NULL, p_tipo_ordem) b
  WHERE b.tipo_unidade IS NOT NULL
  GROUP BY b.ano, b.mes, b.tipo_unidade
  ORDER BY b.ano ASC, b.mes ASC, b.tipo_unidade ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_gestao_resumo_segmentos(
  p_ano integer DEFAULT NULL,
  p_mes integer DEFAULT NULL,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  tipo_unidade text,
  total_ordens integer,
  total_notas integer,
  unidades integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    b.tipo_unidade,
    COUNT(*)::integer AS total_ordens,
    COUNT(DISTINCT b.nota_referencia)::integer AS total_notas,
    COUNT(DISTINCT b.nome_loja)::integer AS unidades
  FROM public.listar_gestao_ordens_base_filtrada(p_ano, p_mes, p_tipo_ordem) b
  WHERE b.tipo_unidade IS NOT NULL
  GROUP BY b.tipo_unidade
  ORDER BY b.tipo_unidade ASC;
$$;

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
      EXTRACT(YEAR FROM f.inicio_programado)::int AS ano
    FROM public.ordens_notas_acompanhamento ona
    JOIN public.ordens_financeiro_importado f
      ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
    WHERE UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), '')) = 'PMPL'
      AND f.inicio_programado IS NOT NULL
  ) base
  WHERE base.ano IS NOT NULL
  ORDER BY base.ano DESC, base.tipo_ordem ASC;
$$;
