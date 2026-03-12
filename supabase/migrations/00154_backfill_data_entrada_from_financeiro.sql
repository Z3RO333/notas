-- 00154_backfill_data_entrada_from_financeiro.sql
--
-- Função que preenche data_entrada em ordens_notas_acompanhamento (Databricks)
-- cruzando com ordens_financeiro_importado (planilha SAP):
--   PMPL → usa inicio_programado
--   PMOS → usa data_entrada
-- Só atualiza onde data_entrada IS NULL.
-- Chamada pela API de import financeiro após cada batch.

CREATE OR REPLACE FUNCTION public.backfill_data_entrada_from_financeiro(p_codigos text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.ordens_notas_acompanhamento ona
  SET
    data_entrada = CASE
      WHEN fi.tipo_ordem = 'PMPL' THEN fi.inicio_programado
      ELSE fi.data_entrada
    END,
    updated_at = NOW()
  FROM public.ordens_financeiro_importado fi
  WHERE ona.ordem_codigo = fi.ordem_codigo
    AND ona.ordem_codigo = ANY(p_codigos)
    AND ona.data_entrada IS NULL
    AND (
      (fi.tipo_ordem = 'PMPL' AND fi.inicio_programado IS NOT NULL)
      OR (fi.tipo_ordem <> 'PMPL' AND fi.data_entrada IS NOT NULL)
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- Backfill one-time: aplica para todas as ordens existentes com data_entrada NULL
DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.ordens_notas_acompanhamento ona
  SET
    data_entrada = CASE
      WHEN fi.tipo_ordem = 'PMPL' THEN fi.inicio_programado
      ELSE fi.data_entrada
    END,
    updated_at = NOW()
  FROM public.ordens_financeiro_importado fi
  WHERE ona.ordem_codigo = fi.ordem_codigo
    AND ona.data_entrada IS NULL
    AND (
      (fi.tipo_ordem = 'PMPL' AND fi.inicio_programado IS NOT NULL)
      OR (fi.tipo_ordem <> 'PMPL' AND fi.data_entrada IS NOT NULL)
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Backfill data_entrada: % ordens atualizadas', v_updated;
END;
$$;
