-- 00246_revert_backfill_ordens_cd104_split.sql
--
-- Reverte o backfill de ordens da migration 00245.
--
-- Motivo: a regra de divisao Brenda Predial / Daniel Equipamentos no CD 104
-- vale apenas para NOTAS novas que entrarem daqui pra frente. Ordens que
-- vieram de notas ja existentes herdam o responsavel da nota e NAO devem
-- ser reatribuidas automaticamente.
--
-- O cadastro do Daniel Duran e a logica de roteamento em distribuir_notas
-- permanecem inalterados: novas notas no CD 104 que casarem keyword
-- equipamento serao distribuidas para Daniel; ordens decorrentes vao
-- herdar dele naturalmente.

DO $$
DECLARE
  v_brenda  UUID;
  v_daniel  UUID;
  v_revertidas INTEGER := 0;
BEGIN
  SELECT id INTO v_brenda FROM public.administradores WHERE LOWER(email) = 'brendafonseca@bemol.com.br' LIMIT 1;
  SELECT id INTO v_daniel FROM public.administradores WHERE LOWER(email) = 'danielduran@bemol.com.br'   LIMIT 1;

  IF v_brenda IS NULL OR v_daniel IS NULL THEN
    RAISE EXCEPTION 'Brenda ou Daniel nao encontrados';
  END IF;

  WITH revert AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET administrador_id = v_brenda,
        updated_at       = now()
    WHERE o.centro = '104'
      AND o.administrador_id = v_daniel
      -- Identificacao precisa: timestamp exato do backfill da 00245
      AND o.updated_at = '2026-05-06 14:53:02.021444+00'
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_revertidas FROM revert;

  RAISE NOTICE 'Backfill 00245 revertido: % ordens devolvidas a Brenda', v_revertidas;
END $$;
