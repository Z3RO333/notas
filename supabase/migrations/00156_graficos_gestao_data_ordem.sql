-- 00156_graficos_gestao_data_ordem.sql
--
-- Corrige a divergencia dos graficos de gestao:
-- - a evolucao mensal e os resumos estavam sendo agregados por data da nota
-- - o ranking por loja ja usava data da ordem
--
-- Regra oficial:
-- - PMOS usa ordens_notas_acompanhamento.data_entrada
-- - PMPL usa ordens_financeiro_importado.inicio_programado

DROP VIEW IF EXISTS public.vw_dashboard_gestao_ordens_base;

CREATE VIEW public.vw_dashboard_gestao_ordens_base AS
WITH pmos_rows AS (
  SELECT
    ona.id AS ordem_id,
    BTRIM(ona.ordem_codigo) AS ordem_codigo,
    COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), 'PMOS') AS tipo_ordem,
    ona.data_entrada::date AS competencia_data,
    EXTRACT(YEAR FROM ona.data_entrada)::int AS ano,
    EXTRACT(MONTH FROM ona.data_entrada)::int AS mes,
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
    COALESCE(
      NULLIF(BTRIM(ona.texto_breve), ''),
      NULLIF(BTRIM(n.descricao), '')
    ) AS texto_breve,
    UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS status_ordem_raw,
    COALESCE(
      ona.nota_id::text,
      NULLIF(BTRIM(ona.numero_nota), ''),
      NULLIF(BTRIM(n.numero_nota), '')
    ) AS nota_referencia
  FROM public.ordens_notas_acompanhamento ona
  LEFT JOIN public.notas_manutencao n
    ON n.id = ona.nota_id
  LEFT JOIN public.dim_denominacao_norm norm
    ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
  WHERE ona.data_entrada IS NOT NULL
    AND UPPER(COALESCE(NULLIF(BTRIM(ona.tipo_ordem), ''), 'PMOS')) <> 'PMPL'
),
pmpl_rows AS (
  SELECT
    ona.id AS ordem_id,
    BTRIM(ona.ordem_codigo) AS ordem_codigo,
    'PMPL'::text AS tipo_ordem,
    f.inicio_programado AS competencia_data,
    EXTRACT(YEAR FROM f.inicio_programado)::int AS ano,
    EXTRACT(MONTH FROM f.inicio_programado)::int AS mes,
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
    COALESCE(
      NULLIF(BTRIM(f.texto_breve), ''),
      NULLIF(BTRIM(ona.texto_breve), ''),
      NULLIF(BTRIM(n.descricao), '')
    ) AS texto_breve,
    UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS status_ordem_raw,
    COALESCE(
      ona.nota_id::text,
      NULLIF(BTRIM(ona.numero_nota), ''),
      NULLIF(BTRIM(f.numero_nota), ''),
      NULLIF(BTRIM(n.numero_nota), '')
    ) AS nota_referencia
  FROM public.ordens_notas_acompanhamento ona
  JOIN public.ordens_financeiro_importado f
    ON BTRIM(f.ordem_codigo) = BTRIM(ona.ordem_codigo)
  LEFT JOIN public.notas_manutencao n
    ON n.id = ona.nota_id
  LEFT JOIN public.dim_denominacao_norm norm
    ON norm.raw_nome = COALESCE(NULLIF(BTRIM(ona.denominacao_unidade), ''), ona.unidade)
  WHERE UPPER(BTRIM(COALESCE(ona.tipo_ordem, ''))) = 'PMPL'
    AND f.inicio_programado IS NOT NULL
)
SELECT * FROM pmos_rows
UNION ALL
SELECT * FROM pmpl_rows;

ALTER VIEW public.vw_dashboard_gestao_ordens_base SET (security_invoker = on);

COMMENT ON VIEW public.vw_dashboard_gestao_ordens_base IS
  'Base unica por ordem para graficos de gestao. PMOS usa data_entrada; PMPL usa inicio_programado.';

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
  FROM public.vw_dashboard_gestao_ordens_base b
  WHERE b.tipo_unidade IS NOT NULL
    AND b.nome_loja IS NOT NULL
    AND BTRIM(b.nome_loja) <> ''
    AND (p_ano IS NULL OR b.ano = p_ano)
    AND (p_mes IS NULL OR b.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(b.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
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
  FROM public.vw_dashboard_gestao_ordens_base b
  WHERE b.tipo_unidade IS NOT NULL
    AND BTRIM(COALESCE(b.texto_breve, '')) <> ''
    AND (p_ano IS NULL OR b.ano = p_ano)
    AND (p_mes IS NULL OR b.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(b.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
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
  FROM public.vw_dashboard_gestao_ordens_base b
  WHERE b.tipo_unidade IS NOT NULL
    AND (p_ano IS NULL OR b.ano = p_ano)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(b.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
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
  FROM public.vw_dashboard_gestao_ordens_base b
  WHERE b.tipo_unidade IS NOT NULL
    AND (p_ano IS NULL OR b.ano = p_ano)
    AND (p_mes IS NULL OR b.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(b.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
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
    b.tipo_ordem,
    b.ano
  FROM public.vw_dashboard_gestao_ordens_base b
  WHERE b.ano IS NOT NULL
    AND b.tipo_ordem IS NOT NULL
    AND BTRIM(b.tipo_ordem) <> ''
  ORDER BY b.ano DESC, b.tipo_ordem ASC;
$$;
