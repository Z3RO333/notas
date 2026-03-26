-- 00192_fix_gestao_base_rpc_ambiguity.sql
--
-- Problema:
-- A migration 00188 adicionou uma nova sobrecarga para
-- listar_gestao_ordens_base_filtrada com 6 parametros defaultados.
-- A sobrecarga anterior com 3 parametros continuou existindo, e isso passou a
-- deixar chamadas SQL posicionais ambiguas dentro das RPCs de Graficos e
-- Comparativos.
--
-- Sintoma:
-- - Graficos: cards/charts vazios ou "Sem dados" porque a page nao propagava
--   o erro das RPCs principais.
-- - Comparativos: a page explode no error boundary quando tenta carregar a
--   parte de ordens.
--
-- Fix:
-- 1) Recria as RPCs afetadas chamando explicitamente a assinatura nova (6 args)
-- 2) Remove a sobrecarga antiga de 3 argumentos para eliminar ambiguidade futura

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
  FROM public.listar_gestao_ordens_base_filtrada(
    p_ano,
    p_mes,
    p_tipo_ordem,
    NULL::text,
    NULL::text,
    NULL::integer
  ) b
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
  FROM public.listar_gestao_ordens_base_filtrada(
    p_ano,
    p_mes,
    p_tipo_ordem,
    NULL::text,
    NULL::text,
    NULL::integer
  ) b
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
  FROM public.listar_gestao_ordens_base_filtrada(
    p_ano,
    NULL::integer,
    p_tipo_ordem,
    NULL::text,
    NULL::text,
    NULL::integer
  ) b
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
  FROM public.listar_gestao_ordens_base_filtrada(
    p_ano,
    p_mes,
    p_tipo_ordem,
    NULL::text,
    NULL::text,
    NULL::integer
  ) b
  WHERE b.tipo_unidade IS NOT NULL
  GROUP BY b.tipo_unidade
  ORDER BY b.tipo_unidade ASC;
$$;

CREATE OR REPLACE FUNCTION public.calcular_comparativo_ordens_mensal(
  p_ano_base integer,
  p_ano_comparado integer,
  p_tipo_ordem text DEFAULT NULL
)
RETURNS TABLE(
  ano integer,
  mes integer,
  total_ordens integer,
  ordens_abertas integer,
  ordens_executadas integer
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
      b.ano,
      b.mes,
      UPPER(BTRIM(COALESCE(b.status_ordem_raw, ''))) AS raw_norm
    FROM selected_years y
    CROSS JOIN LATERAL public.listar_gestao_ordens_base_filtrada(
      y.ano,
      NULL::integer,
      NULLIF(UPPER(BTRIM(COALESCE(p_tipo_ordem, ''))), ''),
      NULL::text,
      NULL::text,
      NULL::integer
    ) b
  ),
  agg AS (
    SELECT
      b.ano,
      b.mes,
      COUNT(*)::integer AS total_ordens,
      COUNT(*) FILTER (
        WHERE b.raw_norm = ANY(ARRAY[
          'ABERTO',
          'ABERTA',
          'EM_EXECUCAO',
          'EQUIPAMENTO_EM_CONSERTO',
          'EXECUCAO_NAO_REALIZADA',
          'ENVIAR_EMAIL_PFORNECEDOR',
          'EM_PROCESSAMENTO',
          'EXECUCAO_INSATISFATORIO'
        ]::text[])
      )::integer AS ordens_abertas,
      COUNT(*) FILTER (
        WHERE b.raw_norm = ANY(ARRAY[
          'CANCELADO',
          'CANCELADA',
          'CONCLUIDO',
          'CONCLUIDA',
          'AGUARDANDO_FATURAMENTO_NF',
          'EXECUCAO_SATISFATORIO',
          'EXECUCAO_SATISFATORIA',
          'AVALIACAO_DA_EXECUCAO',
          'AVALIACAO_DE_EXECUCAO'
        ]::text[])
      )::integer AS ordens_executadas
    FROM base b
    GROUP BY b.ano, b.mes
  )
  SELECT
    y.ano,
    m.mes,
    COALESCE(a.total_ordens, 0) AS total_ordens,
    COALESCE(a.ordens_abertas, 0) AS ordens_abertas,
    COALESCE(a.ordens_executadas, 0) AS ordens_executadas
  FROM selected_years y
  CROSS JOIN months m
  LEFT JOIN agg a
    ON a.ano = y.ano
   AND a.mes = m.mes
  ORDER BY y.ano ASC, m.mes ASC;
$$;

DROP FUNCTION IF EXISTS public.listar_gestao_ordens_base_filtrada(integer, integer, text);
