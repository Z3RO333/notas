-- Migration: 00103_view_dashboard_gestao.sql
-- Cria a view pré-agregada para o painel de inteligência gerencial.
-- Agrupa notas + ordens por loja (unidade), serviço (descricao), tipo_ordem, ano e mês.
-- Não usa DISTINCT desnecessário; agregação prévia evita full scan repetido.

CREATE OR REPLACE VIEW public.vw_dashboard_gestao_manutencao AS
SELECT
  ona.unidade                                                                    AS nome_loja,
  n.centro,
  n.descricao                                                                    AS texto_breve,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int      AS ano,
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int      AS mes,
  COUNT(DISTINCT ona.id)                                                         AS total_ordens,
  COUNT(DISTINCT n.id)                                                           AS total_notas
FROM public.notas_manutencao n
LEFT JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
WHERE n.descricao <> ''
GROUP BY
  ona.unidade,
  n.centro,
  n.descricao,
  ona.tipo_ordem,
  EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date)),
  EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date));
