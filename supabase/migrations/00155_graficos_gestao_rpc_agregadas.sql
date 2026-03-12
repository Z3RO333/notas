-- 00155_graficos_gestao_rpc_agregadas.sql
--
-- Evita truncar meses mais recentes nos graficos de gestao.
-- A pagina estava lendo linhas detalhadas da view com limit(10000) e
-- agregando no app. Quando janeiro+fevereiro ja ocupavam esse corte,
-- marco desaparecia mesmo existindo no banco.
--
-- Estas RPCs fazem a agregacao no Postgres e retornam somente os dados
-- necessarios para cada bloco da tela.

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
    v.texto_breve,
    v.tipo_unidade,
    SUM(v.total_ordens)::integer AS total_ordens
  FROM public.vw_dashboard_gestao_manutencao v
  WHERE v.tipo_unidade IS NOT NULL
    AND BTRIM(COALESCE(v.texto_breve, '')) <> ''
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (p_mes IS NULL OR v.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  GROUP BY v.texto_breve, v.tipo_unidade
  ORDER BY SUM(v.total_ordens) DESC, v.texto_breve ASC;
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
    v.ano,
    v.mes,
    v.tipo_unidade,
    SUM(v.total_ordens)::integer AS total_ordens,
    SUM(v.total_notas)::integer AS total_notas
  FROM public.vw_dashboard_gestao_manutencao v
  WHERE v.tipo_unidade IS NOT NULL
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  GROUP BY v.ano, v.mes, v.tipo_unidade
  ORDER BY v.ano ASC, v.mes ASC, v.tipo_unidade ASC;
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
    v.tipo_unidade,
    SUM(v.total_ordens)::integer AS total_ordens,
    SUM(v.total_notas)::integer AS total_notas,
    COUNT(DISTINCT v.nome_loja)::integer AS unidades
  FROM public.vw_dashboard_gestao_manutencao v
  WHERE v.tipo_unidade IS NOT NULL
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (p_mes IS NULL OR v.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  GROUP BY v.tipo_unidade
  ORDER BY v.tipo_unidade ASC;
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
    v.tipo_ordem,
    v.ano
  FROM public.vw_dashboard_gestao_manutencao v
  WHERE v.ano IS NOT NULL
    AND v.tipo_ordem IS NOT NULL
    AND BTRIM(v.tipo_ordem) <> ''
  ORDER BY v.ano DESC, v.tipo_ordem ASC;
$$;
