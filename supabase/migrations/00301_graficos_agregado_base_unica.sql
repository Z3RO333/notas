-- 00301_graficos_agregado_base_unica.sql
--
-- buscar_graficos_gestao_agregado (00271) chamava 4 sub-RPCs e cada uma
-- re-executava listar_gestao_ordens_base_filtrada do zero (varredura de
-- ordens_notas_acompanhamento + join com ordens_financeiro_importado) —
-- 4 varreduras idênticas por chamada.
--
-- Esta versão materializa a base UMA vez (ano inteiro, via a própria função
-- canônica — sem duplicar a lógica de negócio) e deriva os 4 blocos dela:
--   - evolucao: agrega a base anual direto (as sub-RPCs chamavam com p_mes=NULL)
--   - topLojas/topServicos/segmentos: recorte b.mes = p_mes sobre a base anual,
--     equivalente ao período mensal da base. Fidelidade ao comportamento
--     original: quando p_ano IS NULL a base ignora p_mes (sem filtro de
--     período), então o recorte de mês só se aplica com p_ano preenchido.
--
-- Semântica, nomes de campos e ordenação de cada bloco idênticos às sub-RPCs
-- (calcular_gestao_top_lojas_por_status, calcular_gestao_top_servicos,
-- calcular_gestao_evolucao_mensal, calcular_gestao_resumo_segmentos,
-- listar_gestao_filtros), que permanecem intocadas para os demais callers.

CREATE OR REPLACE FUNCTION public.buscar_graficos_gestao_agregado(
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL,
  p_nome_loja   TEXT DEFAULT NULL,
  p_texto_breve TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base_ano AS MATERIALIZED (
    SELECT *
    FROM public.listar_gestao_ordens_base_filtrada(
      p_ano, NULL::integer, p_tipo_ordem,
      p_texto_breve, NULL::text, NULL::integer, p_nome_loja
    )
  ),
  base_mes AS MATERIALIZED (
    SELECT *
    FROM base_ano b
    WHERE p_ano IS NULL OR p_mes IS NULL OR b.mes = p_mes
  )
  SELECT jsonb_build_object(
    'topLojas', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM (
        SELECT
          b.nome_loja,
          b.tipo_unidade,
          COUNT(*) FILTER (
            WHERE b.status_ordem_raw = ANY(ARRAY[
              'CANCELADO', 'CONCLUIDO', 'AGUARDANDO_FATURAMENTO_NF',
              'EXECUCAO_SATISFATORIO', 'EXECUCAO_SATISFATORIA',
              'AVALIACAO_DA_EXECUCAO', 'AVALIACAO_DE_EXECUCAO'
            ]::text[])
          )::integer AS concluidas,
          COUNT(*) FILTER (
            WHERE b.status_ordem_raw = ANY(ARRAY[
              'ABERTO', 'ABERTA', 'EM_EXECUCAO', 'EQUIPAMENTO_EM_CONSERTO',
              'EXECUCAO_NAO_REALIZADA', 'ENVIAR_EMAIL_PFORNECEDOR',
              'EM_PROCESSAMENTO', 'EXECUCAO_INSATISFATORIO'
            ]::text[])
          )::integer AS em_aberto,
          COUNT(*)::integer AS total_ordens
        FROM base_mes b
        WHERE b.tipo_unidade IS NOT NULL
          AND b.nome_loja IS NOT NULL
          AND BTRIM(b.nome_loja) <> ''
        GROUP BY b.nome_loja, b.tipo_unidade
        ORDER BY total_ordens DESC, b.nome_loja ASC
      ) row
    ), '[]'::JSONB),
    'topServicos', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM (
        SELECT
          b.texto_breve,
          b.tipo_unidade,
          COUNT(*)::integer AS total_ordens
        FROM base_mes b
        WHERE b.tipo_unidade IS NOT NULL
          AND BTRIM(COALESCE(b.texto_breve, '')) <> ''
        GROUP BY b.texto_breve, b.tipo_unidade
        ORDER BY total_ordens DESC, b.texto_breve ASC
      ) row
    ), '[]'::JSONB),
    'evolucao', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM (
        SELECT
          b.ano,
          b.mes,
          b.tipo_unidade,
          COUNT(*)::integer AS total_ordens,
          COUNT(DISTINCT b.nota_referencia)::integer AS total_notas
        FROM base_ano b
        WHERE b.tipo_unidade IS NOT NULL
        GROUP BY b.ano, b.mes, b.tipo_unidade
        ORDER BY b.ano ASC, b.mes ASC, b.tipo_unidade ASC
      ) row
    ), '[]'::JSONB),
    'segmentos', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM (
        SELECT
          b.tipo_unidade,
          COUNT(*)::integer AS total_ordens,
          COUNT(DISTINCT b.nota_referencia)::integer AS total_notas,
          COUNT(DISTINCT b.nome_loja)::integer AS unidades
        FROM base_mes b
        WHERE b.tipo_unidade IS NOT NULL
        GROUP BY b.tipo_unidade
        ORDER BY b.tipo_unidade ASC
      ) row
    ), '[]'::JSONB),
    'opcoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(row))
      FROM public.listar_gestao_filtros() row
    ), '[]'::JSONB)
  );
$$;

COMMENT ON FUNCTION public.buscar_graficos_gestao_agregado(INTEGER, INTEGER, TEXT, TEXT, TEXT) IS
  'Agrega os blocos da tela /admin/graficos em 1 chamada. Desde 00301 materializa a base UMA vez e deriva os 4 blocos (antes re-executava a base 4x).';
