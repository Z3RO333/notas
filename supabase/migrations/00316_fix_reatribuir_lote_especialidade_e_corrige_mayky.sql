-- 00316_fix_reatribuir_lote_especialidade_e_corrige_mayky.sql
--
-- 1. Corrige a causa raiz: reatribuir_notas_lote (modo round_robin) escolhia
--    destinos entre TODOS os admins ativos, sem filtrar por especialidade nem
--    por recebe_distribuicao. Isso vazou notas gerais do Mayky (especialidade
--    'geral') para especialistas de CD (Brenda/cd_manaus, Daniel Duran/
--    cd_manaus_equip, Adriano/cd_taruma — nenhum com recebe_distribuicao=true)
--    e para Suelem (refrigeracao). Fix: destinos do round_robin agora exigem
--    mesma especialidade do admin de origem E recebe_distribuicao = true.
-- 2. Corrige o dado: das 147 notas do Mayky reatribuidas em 2026-07-14
--    14:42:05 (reatribuir_notas_lote, round_robin), 74 foram parar com
--    Adriano/Brenda/Daniel Duran/Suelem Silva e ainda estao com status
--    'nova' (nao tocadas desde). Move essas 74 de volta para o pool geral
--    (Paula/Rosana/Fabiola/Wanderlucio) por balanceamento guloso, com
--    auditoria em notas_historico e nota_acompanhamentos.

-- ============================================================
-- 1) Corrige reatribuir_notas_lote: destinos do round_robin
--    precisam ter a MESMA especialidade do admin de origem.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reatribuir_notas_lote(
  p_admin_origem UUID,
  p_gestor_id UUID,
  p_modo TEXT,
  p_admin_destino UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(nota_id UUID, administrador_destino_id UUID) AS $$
#variable_conflict use_column
DECLARE
  v_destinos UUID[];
  v_destinos_count INTEGER;
  v_rr_index INTEGER := 1;
  v_nota RECORD;
  v_destino UUID;
  v_origem_especialidade TEXT;
BEGIN
  PERFORM 1
  FROM public.administradores g
  WHERE g.id = p_gestor_id
    AND g.role = 'gestor'
    AND g.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gestor inválido para reatribuição em lote';
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido. Use destino_unico ou round_robin';
  END IF;

  SELECT a.especialidade INTO v_origem_especialidade
  FROM public.administradores a
  WHERE a.id = p_admin_origem
    AND a.role = 'admin';

  IF v_origem_especialidade IS NULL THEN
    RAISE EXCEPTION 'Admin de origem inválido';
  END IF;

  IF p_modo = 'destino_unico' THEN
    IF p_admin_destino IS NULL THEN
      RAISE EXCEPTION 'Destino obrigatorio para modo destino_unico';
    END IF;

    PERFORM 1
    FROM public.administradores a
    WHERE a.id = p_admin_destino
      AND a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.id <> p_admin_origem;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destino unico inválido';
    END IF;
  ELSE
    -- FIX 00316: destinos do round_robin restritos à mesma especialidade
    -- do admin de origem e que efetivamente recebem distribuição — evita
    -- vazar notas gerais para especialistas de CD/refrigeração e vice-versa.
    SELECT array_agg(a.id ORDER BY a.nome) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.recebe_distribuicao = true
      AND a.especialidade = v_origem_especialidade
      AND a.id <> p_admin_origem;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Não existem destinos elegíveis para round_robin';
    END IF;
  END IF;

  FOR v_nota IN
    SELECT nm.id, nm.administrador_id
    FROM public.notas_manutencao nm
    WHERE nm.administrador_id = p_admin_origem
      AND nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ORDER BY COALESCE(nm.data_criacao_sap::TIMESTAMP, nm.created_at), nm.created_at
    FOR UPDATE
  LOOP
    IF p_modo = 'destino_unico' THEN
      v_destino := p_admin_destino;
    ELSE
      v_destino := v_destinos[v_rr_index];
      v_rr_index := (v_rr_index % v_destinos_count) + 1;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_destino,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      COALESCE(v_nota.administrador_id::TEXT, 'NULL'),
      v_destino::TEXT,
      p_gestor_id,
      COALESCE(p_motivo, 'Reatribuição em lote pelo gestor (' || p_modo || ')')
    );

    IF v_nota.administrador_id IS NOT NULL THEN
      INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
      VALUES (v_nota.id, v_nota.administrador_id, 'reatribuicao')
      ON CONFLICT ON CONSTRAINT uq_nota_acompanhamentos_nota_admin DO NOTHING;
    END IF;

    nota_id := v_nota.id;
    administrador_destino_id := v_destino;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2) Backfill: move as 74 notas do Mayky que vazaram para fora
--    do pool geral de volta para Paula/Rosana/Fabiola/Wanderlucio,
--    por balanceamento guloso (quem tem menos notas abertas recebe
--    a próxima).
-- ============================================================
DO $$
DECLARE
  v_gestor_id   UUID;
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
  SELECT id INTO v_gestor_id FROM public.administradores WHERE email = 'walterrodrigues@bemol.com.br';

  SELECT id INTO v_paula_id   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';
  SELECT id INTO v_rosana_id  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola_id FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_wander_id  FROM public.administradores WHERE nome = 'Wanderlucio Mendes';

  IF v_gestor_id IS NULL OR v_paula_id IS NULL OR v_rosana_id IS NULL
     OR v_fabiola_id IS NULL OR v_wander_id IS NULL THEN
    RAISE EXCEPTION 'Correcao 00316 abortada: gestor ou algum destino do pool geral não encontrado';
  END IF;

  SELECT count(*) INTO v_cnt_paula   FROM public.notas_manutencao WHERE administrador_id = v_paula_id   AND status IN ('nova','em_andamento','encaminhada_fornecedor');
  SELECT count(*) INTO v_cnt_rosana  FROM public.notas_manutencao WHERE administrador_id = v_rosana_id  AND status IN ('nova','em_andamento','encaminhada_fornecedor');
  SELECT count(*) INTO v_cnt_fabiola FROM public.notas_manutencao WHERE administrador_id = v_fabiola_id AND status IN ('nova','em_andamento','encaminhada_fornecedor');
  SELECT count(*) INTO v_cnt_wander  FROM public.notas_manutencao WHERE administrador_id = v_wander_id  AND status IN ('nova','em_andamento','encaminhada_fornecedor');

  FOR v_rec IN
    SELECT DISTINCT nm.id, nm.administrador_id
    FROM public.notas_historico nh
    JOIN public.notas_manutencao nm ON nm.id = nh.nota_id
    WHERE nh.campo_alterado = 'administrador_id'
      AND nh.created_at = '2026-07-14 14:42:05.784688+00'
      AND nh.valor_novo::uuid IN (
        SELECT id FROM public.administradores
        WHERE nome IN ('Adriano Bezerra', 'Brenda Fonseca', 'Daniel Duran', 'Suelem Silva')
      )
      AND nm.administrador_id = nh.valor_novo::uuid
      AND nm.status = 'nova'
    ORDER BY nm.id
  LOOP
    IF v_cnt_paula <= v_cnt_rosana AND v_cnt_paula <= v_cnt_fabiola AND v_cnt_paula <= v_cnt_wander THEN
      v_destino := v_paula_id;
      v_cnt_paula := v_cnt_paula + 1;
    ELSIF v_cnt_rosana <= v_cnt_fabiola AND v_cnt_rosana <= v_cnt_wander THEN
      v_destino := v_rosana_id;
      v_cnt_rosana := v_cnt_rosana + 1;
    ELSIF v_cnt_fabiola <= v_cnt_wander THEN
      v_destino := v_fabiola_id;
      v_cnt_fabiola := v_cnt_fabiola + 1;
    ELSE
      v_destino := v_wander_id;
      v_cnt_wander := v_cnt_wander + 1;
    END IF;

    UPDATE public.notas_manutencao
    SET administrador_id = v_destino,
        distribuida_em   = now(),
        updated_at       = now()
    WHERE id = v_rec.id;

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, alterado_por, motivo)
    VALUES (
      v_rec.id,
      'administrador_id',
      v_rec.administrador_id::TEXT,
      v_destino::TEXT,
      v_gestor_id,
      'Correção migration 00316: nota do Mayky tinha vazado do pool geral (round_robin sem filtro de especialidade)'
    );

    INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
    VALUES (v_rec.id, v_rec.administrador_id, 'correcao_migration_00316')
    ON CONFLICT ON CONSTRAINT uq_nota_acompanhamentos_nota_admin DO NOTHING;

    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Migration 00316: % notas do Mayky corrigidas de volta para o pool geral.', v_total;
END $$;
