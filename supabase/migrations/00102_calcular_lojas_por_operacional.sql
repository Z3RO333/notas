-- 00102_calcular_lojas_por_operacional.sql
-- Nova RPC que retorna as lojas atendidas por cada operacional,
-- permitindo ao front exibir o detalhamento por unidade.

CREATE OR REPLACE FUNCTION public.calcular_lojas_por_operacional(
  p_data_inicio TIMESTAMPTZ,
  p_data_fim    TIMESTAMPTZ
)
RETURNS TABLE(
  fornecedor_codigo TEXT,
  unidade           TEXT,
  qtd_atendidas     INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.fornecedor_codigo,
    o.unidade,
    COUNT(*)::INTEGER AS qtd_atendidas
  FROM public.ordens_notas_acompanhamento o
  JOIN public.dim_operacionais d ON d.codigo = o.fornecedor_codigo
  WHERE
    o.ordem_detectada_em >= p_data_inicio
    AND o.ordem_detectada_em < p_data_fim
    AND o.status_ordem = 'concluida'
    AND o.unidade IS NOT NULL
    AND BTRIM(o.unidade) <> ''
  GROUP BY o.fornecedor_codigo, o.unidade
  ORDER BY o.fornecedor_codigo, qtd_atendidas DESC;
END;
$$;
