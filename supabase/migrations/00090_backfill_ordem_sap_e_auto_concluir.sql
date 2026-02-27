-- 00090_backfill_ordem_sap_e_auto_concluir.sql
-- Preenche ordem_sap de notas abertas usando ordens_manutencao_referencia,
-- depois chama registrar_ordens_por_notas para auto-concluir e
-- sincroniza cockpit.
--
-- Resolve: notas com ordens reais em SAP (capturadas via selecao_ordens_manutencao)
-- que nunca tiveram ordem_sap preenchido no qmel_clean → ficavam abertas no painel.

-- ============================================================
-- Função: backfill_ordem_sap_de_referencia
-- ============================================================
CREATE OR REPLACE FUNCTION public.backfill_ordem_sap_de_referencia(
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(notas_atualizadas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Atualiza ordem_sap para notas abertas sem ordem
  -- usando o link nota → ordem capturado em ordens_manutencao_referencia
  -- (fonte: selecao_ordens_manutencao silver table, já deduplicado)
  UPDATE public.notas_manutencao nm
  SET
    ordem_sap  = r.ordem_codigo_norm,
    updated_at = now()
  FROM public.ordens_manutencao_referencia r
  WHERE r.numero_nota_norm = nm.numero_nota
    AND nm.ordem_sap IS NULL
    AND nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Registra no historico cada nota que teve ordem_sap preenchida
  INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
  SELECT
    nm.id,
    'ordem_sap',
    NULL,
    r.ordem_codigo_norm,
    'Backfill de ordens_manutencao_referencia (migration 00090)'
      || CASE WHEN p_sync_id IS NOT NULL THEN ' sync_id: ' || p_sync_id::TEXT ELSE '' END
  FROM public.notas_manutencao nm
  JOIN public.ordens_manutencao_referencia r ON r.numero_nota_norm = nm.numero_nota
  WHERE nm.ordem_sap = r.ordem_codigo_norm
    AND nm.updated_at >= now() - interval '5 seconds'
    AND nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor', 'concluida');

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION public.backfill_ordem_sap_de_referencia(UUID) IS
  'Preenche notas_manutencao.ordem_sap para notas abertas sem ordem, '
  'usando ordens_manutencao_referencia como fonte (selecao_ordens_manutencao silver). '
  'Idempotente: só toca notas com ordem_sap IS NULL. '
  'Deve ser chamada antes de registrar_ordens_por_notas no ciclo de sync.';

-- ============================================================
-- Execução imediata (sequência segura)
-- ============================================================
DO $$
DECLARE
  v_backfill     INTEGER;
  v_detectadas   INTEGER;
  v_concluidas   INTEGER;
  v_elegiveis    INTEGER;
  v_ref          RECORD;
BEGIN
  -- 1. Preenche ordem_sap das notas com link na referência
  SELECT notas_atualizadas INTO v_backfill
  FROM public.backfill_ordem_sap_de_referencia(NULL);

  RAISE NOTICE 'backfill_ordem_sap: notas_atualizadas=%', v_backfill;

  -- 2. Registra ordens detectadas + auto-conclui notas com ordem
  SELECT ordens_detectadas, notas_auto_concluidas
  INTO v_detectadas, v_concluidas
  FROM public.registrar_ordens_por_notas(NULL);

  RAISE NOTICE 'registrar_ordens_por_notas: ordens_detectadas=% notas_auto_concluidas=%',
    v_detectadas, v_concluidas;

  -- 3. Atualiza cockpit (remove notas concluídas, mantém elegíveis corretos)
  SELECT total_elegiveis INTO v_elegiveis
  FROM public.sincronizar_cockpit_convergencia(NULL);

  RAISE NOTICE 'sincronizar_cockpit_convergencia: total_elegiveis=%', v_elegiveis;
END;
$$;
