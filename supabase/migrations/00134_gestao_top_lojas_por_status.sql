-- 00134_gestao_top_lojas_por_status.sql
-- RPC para o painel de Gráficos: retorna top lojas/farmas/CDs com breakdown
-- de ordens concluídas vs em aberto, usando status_ordem_raw da tabela base.

CREATE OR REPLACE FUNCTION public.calcular_gestao_top_lojas_por_status(
  p_ano        INTEGER DEFAULT NULL,
  p_mes        INTEGER DEFAULT NULL,
  p_tipo_ordem TEXT    DEFAULT NULL
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
    'CANCELADO',
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO',
    'EXECUCAO_SATISFATORIA',
    'AVALIACAO_DA_EXECUCAO',
    'AVALIACAO_DE_EXECUCAO'
  ];
  v_status_abertos CONSTANT TEXT[] := ARRAY[
    'ABERTO',
    'ABERTA',
    'EM_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR',
    'EM_PROCESSAMENTO',
    'EXECUCAO_INSATISFATORIO'
  ];
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      ona.unidade AS unidade,
      CASE
        WHEN UPPER(ona.unidade) LIKE 'CD %'      THEN 'CD'
        WHEN UPPER(ona.unidade) LIKE 'FARMA %'
          OR UPPER(ona.unidade) LIKE 'BEMOL FARMA %' THEN 'FARMA'
        WHEN ona.unidade IS NOT NULL              THEN 'LOJA'
        ELSE NULL
      END AS tipo_unidade,
      UPPER(BTRIM(COALESCE(ona.status_ordem_raw, ''))) AS raw_norm
    FROM public.notas_manutencao n
    JOIN public.ordens_notas_acompanhamento ona ON ona.nota_id = n.id
    WHERE
      ona.unidade IS NOT NULL
      AND BTRIM(ona.unidade) <> ''
      AND (p_ano IS NULL OR EXTRACT(YEAR  FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(n.data_criacao_sap, n.created_at::date))::int = p_mes)
      AND (p_tipo_ordem IS NULL OR ona.tipo_ordem = p_tipo_ordem)
  )
  SELECT
    b.unidade                                                              AS nome_loja,
    b.tipo_unidade,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_concluidos))::INTEGER AS concluidas,
    COUNT(*) FILTER (WHERE b.raw_norm = ANY(v_status_abertos))::INTEGER    AS em_aberto,
    COUNT(*)::INTEGER                                                       AS total_ordens
  FROM base b
  WHERE b.tipo_unidade IS NOT NULL
  GROUP BY b.unidade, b.tipo_unidade
  ORDER BY total_ordens DESC;
END;
$$;
