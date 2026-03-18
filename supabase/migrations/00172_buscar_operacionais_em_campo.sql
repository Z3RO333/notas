-- Migration 00172: RPC para buscar operacionais com ordens em execução
-- Usada pelo modal "Operacionais em Campo" no painel de ordens (admins)

CREATE OR REPLACE FUNCTION public.buscar_operacionais_em_campo()
RETURNS TABLE(
  fornecedor_codigo  TEXT,
  fornecedor_nome    TEXT,
  total_em_campo     INTEGER,
  ordens             TEXT[],
  unidades           TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.codigo                                                    AS fornecedor_codigo,
    d.nome                                                      AS fornecedor_nome,
    COUNT(*)::INTEGER                                           AS total_em_campo,
    ARRAY_AGG(DISTINCT o.ordem_codigo ORDER BY o.ordem_codigo)  AS ordens,
    ARRAY_AGG(DISTINCT o.unidade      ORDER BY o.unidade)       AS unidades
  FROM public.ordens_notas_acompanhamento o
  INNER JOIN public.dim_operacionais d
    ON d.codigo = REGEXP_REPLACE(o.fornecedor_codigo, '[^0-9]', '', 'g')
  WHERE o.status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'EM_EXECUCAO')
  GROUP BY d.codigo, d.nome
  ORDER BY total_em_campo DESC, d.nome;
$$;
