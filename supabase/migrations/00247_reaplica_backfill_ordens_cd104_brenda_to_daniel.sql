-- 00247_reaplica_backfill_ordens_cd104_brenda_to_daniel.sql
--
-- Re-aplica o backfill da 00245 que tinha sido revertido pela 00246.
--
-- Esclarecimento: a regra "nao auto-redistribuir" vale para ordens vinculadas
-- a notas com OUTROS admins (que assumiram manualmente). As ordens que
-- estavam com Brenda no CD 104 e que sao equipamentos PODEM ir para Daniel.

DO $$
DECLARE
  v_brenda  UUID;
  v_daniel  UUID;
  v_movidas INTEGER := 0;
BEGIN
  SELECT id INTO v_brenda FROM public.administradores WHERE LOWER(email) = 'brendafonseca@bemol.com.br' LIMIT 1;
  SELECT id INTO v_daniel FROM public.administradores WHERE LOWER(email) = 'danielduran@bemol.com.br'   LIMIT 1;

  IF v_brenda IS NULL OR v_daniel IS NULL THEN
    RAISE EXCEPTION 'Brenda ou Daniel nao encontrados';
  END IF;

  WITH ordens_alvo AS (
    SELECT o.id
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE o.centro = '104'
      AND o.administrador_id = v_brenda
      AND COALESCE(o.status_ordem_raw,'') NOT IN (
        'CONCLUIDO','CANCELADO',
        'AGUARDANDO_FATURAMENTO_NF',
        'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
        'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
      )
      AND public.is_cd_manaus_equipamento(COALESCE(n.descricao, ''))
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET administrador_id = v_daniel,
        updated_at       = now()
    FROM ordens_alvo
    WHERE o.id = ordens_alvo.id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_movidas FROM upd;

  RAISE NOTICE 'Backfill 00247 (re-aplicacao 00245): % ordens Brenda -> Daniel no CD 104', v_movidas;
END $$;
