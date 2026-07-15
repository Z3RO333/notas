-- 00306_mayky_desligado_redistribuicao.sql
--
-- Mayky Castro foi desligado da empresa.
-- 1. Desativa o admin (ativo=false, recebe_distribuicao=false) — para de receber notas/ordens novas.
-- 2. Realoca a carteira PMPL do fornecedor 101 (CLAUDIO ANDRADE JUNIOR, "Grupo Gerador/Subestação")
--    para Paula Matos via RPC existente (migration 00254), com auditoria em pmpl_carteira_audit.
-- 3. Redistribui as 297 ordens PMOS abertas restantes entre Paula/Rosana/Fabiola por balanceamento
--    guloso (quem tem menos ordens abertas recebe a próxima), equalizando a carga total.
--
-- Estado antes da migration (verificado em produção):
--   Mayky: 0 notas abertas, 581 ordens abertas (297 PMOS + 284 PMPL, todas do fornecedor 101)
--   Paula: 355 ordens abertas | Rosana: 733 | Fabiola: 709

-- ============================================================
-- 1) Realoca carteira PMPL do fornecedor 101 para Paula
-- ============================================================
DO $$
DECLARE
  v_gestor_id UUID;
  v_paula_id  UUID;
BEGIN
  SELECT id INTO v_gestor_id FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';
  IF v_gestor_id IS NULL THEN
    SELECT id INTO v_gestor_id FROM public.administradores WHERE role = 'gestor' AND ativo = true LIMIT 1;
  END IF;

  SELECT id INTO v_paula_id FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';

  IF v_paula_id IS NULL THEN
    RAISE EXCEPTION 'Admin Paula não encontrada';
  END IF;

  PERFORM public.realocar_carteira_pmpl_fornecedor(
    '101',
    v_paula_id,
    v_gestor_id,
    'Mayky desligado — carteira PMPL fornecedor 101 realocada (migration 00306)'
  );
END $$;

-- ============================================================
-- 2) Redistribui as ordens PMOS abertas restantes (balanceamento guloso)
-- ============================================================
DO $$
DECLARE
  v_mayky_id    UUID;
  v_paula_id    UUID;
  v_rosana_id   UUID;
  v_fabiola_id  UUID;
  v_cnt_paula   INTEGER;
  v_cnt_rosana  INTEGER;
  v_cnt_fabiola INTEGER;
  v_rec         RECORD;
  v_destino     UUID;
  v_total       INTEGER := 0;
BEGIN
  SELECT id INTO v_mayky_id   FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_paula_id   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_rosana_id  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola_id FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';

  IF v_mayky_id IS NULL THEN
    RAISE EXCEPTION 'Admin Mayky não encontrado';
  END IF;

  SELECT COUNT(*) INTO v_cnt_paula   FROM public.ordens_notas_acompanhamento WHERE administrador_id = v_paula_id   AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');
  SELECT COUNT(*) INTO v_cnt_rosana  FROM public.ordens_notas_acompanhamento WHERE administrador_id = v_rosana_id  AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');
  SELECT COUNT(*) INTO v_cnt_fabiola FROM public.ordens_notas_acompanhamento WHERE administrador_id = v_fabiola_id AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA');

  FOR v_rec IN
    SELECT id
    FROM public.ordens_notas_acompanhamento
    WHERE administrador_id = v_mayky_id
      AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
    ORDER BY id
  LOOP
    IF v_cnt_paula <= v_cnt_rosana AND v_cnt_paula <= v_cnt_fabiola THEN
      v_destino := v_paula_id;
      v_cnt_paula := v_cnt_paula + 1;
    ELSIF v_cnt_rosana <= v_cnt_fabiola THEN
      v_destino := v_rosana_id;
      v_cnt_rosana := v_cnt_rosana + 1;
    ELSE
      v_destino := v_fabiola_id;
      v_cnt_fabiola := v_cnt_fabiola + 1;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_destino,
        updated_at       = now()
    WHERE id = v_rec.id;

    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Redistribuídas % ordens PMOS restantes do Mayky entre Paula/Rosana/Fabiola.', v_total;
END $$;

-- ============================================================
-- 3) Desativa Mayky
-- ============================================================
UPDATE public.administradores
SET ativo               = false,
    recebe_distribuicao = false,
    updated_at          = now()
WHERE email = 'maykycastro@bemol.com.br';
