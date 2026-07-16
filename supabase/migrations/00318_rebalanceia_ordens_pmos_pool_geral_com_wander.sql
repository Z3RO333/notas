-- 00318_rebalanceia_ordens_pmos_pool_geral_com_wander.sql
--
-- A redistribuicao original do Mayky (migration 00307) so incluiu Paula/
-- Rosana/Fabiola no rateio das 297 ordens PMOS abertas — Wanderlucio Mendes
-- (tambem especialidade 'geral', recebe_distribuicao=true) ficou de fora por
-- decisao/omissao da migration original, nao por bug (diferente do caso das
-- notas, corrigido na 00316).
--
-- Duas noites de fluxo normal ja equalizaram boa parte da diferenca (751-765
-- ordens abertas por admin), mas a pedido do gestor este backfill forca a
-- equalizacao explicita entre os 4 do pool geral, restrita a ordens PMOS
-- (e sem tipo_ordem) — nao mexe em PMPL, que segue a carteira por fornecedor
-- (pmpl_carteira_fornecedor), gerida separadamente.

DO $$
DECLARE
  v_paula_id    UUID;
  v_rosana_id   UUID;
  v_fabiola_id  UUID;
  v_wander_id   UUID;
  v_cnt_paula   INTEGER;
  v_cnt_rosana  INTEGER;
  v_cnt_fabiola INTEGER;
  v_cnt_wander  INTEGER;
  v_rec         RECORD;
  v_destino     UUID;
  v_total       INTEGER := 0;
BEGIN
  SELECT id INTO v_paula_id   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_rosana_id  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola_id FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_wander_id  FROM public.administradores WHERE nome = 'Wanderlucio Mendes';

  IF v_paula_id IS NULL OR v_rosana_id IS NULL OR v_fabiola_id IS NULL OR v_wander_id IS NULL THEN
    RAISE EXCEPTION 'Rebalanceamento 00318 abortado: algum destino do pool geral não encontrado';
  END IF;

  SELECT count(*) INTO v_cnt_paula
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id = v_paula_id
    AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
    AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  SELECT count(*) INTO v_cnt_rosana
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id = v_rosana_id
    AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
    AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  SELECT count(*) INTO v_cnt_fabiola
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id = v_fabiola_id
    AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
    AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  SELECT count(*) INTO v_cnt_wander
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id = v_wander_id
    AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
    AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  -- Move ordens do mais carregado (dentre Paula/Rosana/Fabiola) para o
  -- Wanderlucio ate as 4 cargas ficarem o mais equalizadas possivel.
  WHILE (GREATEST(v_cnt_paula, v_cnt_rosana, v_cnt_fabiola) - v_cnt_wander) > 1 LOOP
    IF v_cnt_paula >= v_cnt_rosana AND v_cnt_paula >= v_cnt_fabiola THEN
      SELECT id INTO v_rec
      FROM public.ordens_notas_acompanhamento
      WHERE administrador_id = v_paula_id
        AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
        AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
      ORDER BY id
      LIMIT 1;
      v_cnt_paula := v_cnt_paula - 1;
    ELSIF v_cnt_rosana >= v_cnt_fabiola THEN
      SELECT id INTO v_rec
      FROM public.ordens_notas_acompanhamento
      WHERE administrador_id = v_rosana_id
        AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
        AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
      ORDER BY id
      LIMIT 1;
      v_cnt_rosana := v_cnt_rosana - 1;
    ELSE
      SELECT id INTO v_rec
      FROM public.ordens_notas_acompanhamento
      WHERE administrador_id = v_fabiola_id
        AND (tipo_ordem = 'PMOS' OR tipo_ordem IS NULL)
        AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
      ORDER BY id
      LIMIT 1;
      v_cnt_fabiola := v_cnt_fabiola - 1;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_wander_id,
        updated_at       = now()
    WHERE id = v_rec.id;

    v_cnt_wander := v_cnt_wander + 1;
    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Migration 00318: % ordens PMOS movidas para Wanderlucio Mendes para equalizar o pool geral (Paula=%, Rosana=%, Fabiola=%, Wanderlucio=%).',
    v_total, v_cnt_paula, v_cnt_rosana, v_cnt_fabiola, v_cnt_wander;
END $$;
