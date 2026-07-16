-- 00311_fix_mayky_leak_notas_admin_root_cause.sql
--
-- Migration 00307 corrigiu o administrador_id das ORDENS abertas do Mayky, mas não
-- tocou em notas_manutencao.administrador_id (que continuou apontando pra ele em
-- 571 notas já concluídas/canceladas, todas já com ordem vinculada).
--
-- registrar_ordens_por_notas() sempre prioriza o admin da NOTA sobre o da ordem
-- (COALESCE v_nota.administrador_id primeiro) — então todo sync do SAP que
-- reprocessava essas ordens revertia a correção de volta pro Mayky. Foi o que
-- aconteceu em 2026-07-15 ~12:01 UTC: 277 ordens voltaram pra ele.
--
-- Fix definitivo: reatribui as 571 notas (raiz do vazamento) entre Paula/Rosana/
-- Fabiola/Wanderlucio por balanceamento guloso, e sincroniza as ordens vinculadas
-- que ainda apontavam pro Mayky para o mesmo novo dono.

DO $$
DECLARE
  v_mayky_id    UUID;
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
  SELECT id INTO v_mayky_id   FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_paula_id   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_rosana_id  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola_id FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_wander_id  FROM public.administradores WHERE email = 'wanderluciomendes@bemol.com.br';

  IF v_mayky_id IS NULL THEN
    RAISE EXCEPTION 'Admin Mayky não encontrado';
  END IF;

  SELECT COUNT(*) INTO v_cnt_paula   FROM public.ordens_notas_acompanhamento WHERE administrador_id=v_paula_id   AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');
  SELECT COUNT(*) INTO v_cnt_rosana  FROM public.ordens_notas_acompanhamento WHERE administrador_id=v_rosana_id  AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');
  SELECT COUNT(*) INTO v_cnt_fabiola FROM public.ordens_notas_acompanhamento WHERE administrador_id=v_fabiola_id AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');
  SELECT COUNT(*) INTO v_cnt_wander  FROM public.ordens_notas_acompanhamento WHERE administrador_id=v_wander_id  AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  FOR v_rec IN
    SELECT id FROM public.notas_manutencao WHERE administrador_id = v_mayky_id ORDER BY id
  LOOP
    IF v_cnt_paula <= v_cnt_rosana AND v_cnt_paula <= v_cnt_fabiola AND v_cnt_paula <= v_cnt_wander THEN
      v_destino := v_paula_id; v_cnt_paula := v_cnt_paula + 1;
    ELSIF v_cnt_wander <= v_cnt_rosana AND v_cnt_wander <= v_cnt_fabiola THEN
      v_destino := v_wander_id; v_cnt_wander := v_cnt_wander + 1;
    ELSIF v_cnt_rosana <= v_cnt_fabiola THEN
      v_destino := v_rosana_id; v_cnt_rosana := v_cnt_rosana + 1;
    ELSE
      v_destino := v_fabiola_id; v_cnt_fabiola := v_cnt_fabiola + 1;
    END IF;

    UPDATE public.notas_manutencao SET administrador_id = v_destino, updated_at = now() WHERE id = v_rec.id;

    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_destino, updated_at = now()
    WHERE nota_id = v_rec.id AND administrador_id = v_mayky_id;

    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Notas do Mayky corrigidas (raiz do vazamento): %', v_total;
END $$;
