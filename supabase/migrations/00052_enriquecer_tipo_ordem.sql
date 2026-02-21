-- 00052_enriquecer_tipo_ordem.sql
-- RPC para enriquecer tipo_ordem em ordens_notas_acompanhamento
-- usando a tabela de referência ordens_tipo_documento_referencia.
--
-- Contexto: ordens que entram via registrar_ordens_por_notas() ficam com
-- tipo_ordem = NULL porque a função não popula esse campo. A tabela de
-- referência (00049) tem o tipo correto por ordem_codigo. Esta RPC
-- sincroniza os dois, rodando a cada ciclo do job após upsert_orders_document_reference.

CREATE OR REPLACE FUNCTION public.enriquecer_tipo_ordem_por_referencia()
RETURNS INTEGER   -- quantidade de linhas atualizadas
LANGUAGE plpgsql
AS $$
DECLARE
  v_atualizadas INTEGER;
BEGIN
  UPDATE public.ordens_notas_acompanhamento o
  SET
    tipo_ordem = r.tipo_documento_vendas,
    updated_at = now()
  FROM public.ordens_tipo_documento_referencia r
  WHERE o.ordem_codigo = r.ordem_codigo_norm
    AND o.tipo_ordem IS NULL
    AND r.tipo_documento_vendas IS NOT NULL;

  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;
  RETURN v_atualizadas;
END;
$$;

COMMENT ON FUNCTION public.enriquecer_tipo_ordem_por_referencia() IS
  'Preenche tipo_ordem (PMOS/PMPL) em ordens sem tipo usando ordens_tipo_documento_referencia. '
  'Chamada pelo job após upsert da tabela de referência.';
