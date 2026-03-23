-- 00180_equipamentos_rpc_linhas_e_anos.sql
--
-- Completa a camada de RPCs da pagina de equipamentos para que
-- servicos/evolucao/anos nao dependam de SELECT direto na view.
-- Isso evita diferencas de visibilidade entre gestores quando a pagina
-- precisa ler dados agregados de equipamentos criticos.

DROP FUNCTION IF EXISTS public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.buscar_equipamentos_criticos_linhas(
  p_categoria   TEXT,
  p_ano         INTEGER DEFAULT NULL,
  p_mes         INTEGER DEFAULT NULL,
  p_tipo_ordem  TEXT DEFAULT NULL
)
RETURNS TABLE(
  texto_breve  TEXT,
  nome_loja    TEXT,
  ano          INTEGER,
  mes          INTEGER,
  total_ordens BIGINT,
  total_notas  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    NULLIF(BTRIM(v.texto_breve), '') AS texto_breve,
    v.nome_loja,
    v.ano,
    v.mes,
    v.total_ordens,
    v.total_notas
  FROM public.vw_equipamentos_criticos v
  WHERE v.categoria = p_categoria
    AND v.nome_loja IS NOT NULL
    AND BTRIM(v.nome_loja) <> ''
    AND NULLIF(BTRIM(v.texto_breve), '') IS NOT NULL
    AND (p_ano IS NULL OR v.ano = p_ano)
    AND (p_mes IS NULL OR v.mes = p_mes)
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  ORDER BY v.total_ordens DESC, v.nome_loja ASC, v.texto_breve ASC
  LIMIT 5000;
END;
$$;

COMMENT ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT) IS
  'Linhas agregadas da pagina de equipamentos (servicos realizados + evolucao mensal), lidas via SECURITY DEFINER para evitar dependencia de SELECT direto na view.';

DROP FUNCTION IF EXISTS public.listar_equipamentos_criticos_anos(TEXT);
CREATE OR REPLACE FUNCTION public.listar_equipamentos_criticos_anos(
  p_tipo_ordem TEXT DEFAULT NULL
)
RETURNS TABLE(
  ano INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT v.ano
  FROM public.vw_equipamentos_criticos v
  WHERE v.ano IS NOT NULL
    AND (
      p_tipo_ordem IS NULL
      OR UPPER(BTRIM(COALESCE(v.tipo_ordem, ''))) = UPPER(BTRIM(p_tipo_ordem))
    )
  ORDER BY v.ano DESC;
END;
$$;

COMMENT ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT) IS
  'Lista anos disponiveis para a pagina de equipamentos sem depender de SELECT direto na view.';

REVOKE ALL ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_equipamentos_criticos_linhas(TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_equipamentos_criticos_anos(TEXT) TO authenticated;
