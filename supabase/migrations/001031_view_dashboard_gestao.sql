-- Migration: 00103_view_dashboard_gestao.sql
-- Cria a view pré-agregada para o painel de inteligência gerencial.
-- Agrupa notas + ordens por loja (unidade), serviço (descricao), tipo_ordem, ano e mês.
-- Classifica automaticamente em LOJA / FARMA / CD via prefixo do nome da unidade.
-- DROP necessário para recriar com nova coluna tipo_unidade inserida no meio.

DROP VIEW IF EXISTS public.vw_dashboard_gestao_manutencao;

CREATE VIEW public.vw_dashboard_gestao_manutencao AS
SELECT
  ona.unidade                                                                    AS nome_loja,
  n.centro,
  n.descricao                                                                    AS texto_breve,
  ona.tipo_ordem,
  CASE
    WHEN upper(ona.unidade) LIKE 'CD %'
      THEN 'CD'
    WHEN upper(ona.unidade) LIKE 'FARMA %'
      OR upper(ona.unidade) LIKE 'BEMOL FARMA %'
      THEN 'FARMA'
    WHEN ona.unidade IS NOT NULL
      THEN 'LOJA'
    ELSE NULL
  END                                                                            AS tipo_unidade,
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
