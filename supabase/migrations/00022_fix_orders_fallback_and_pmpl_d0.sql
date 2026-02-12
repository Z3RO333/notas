-- 00022_fix_orders_fallback_and_pmpl_d0.sql
-- PMPL D0 + fallback automatico de responsavel para ordens sem dono

-- ============================================================
-- 1) HELPERS DE FALLBACK
-- ============================================================
CREATE OR REPLACE FUNCTION public.pick_fallback_admin_for_order(
  p_centro TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  -- p_centro mantido para evolucao futura por unidade.
  SELECT a.id
  INTO v_admin_id
  FROM public.administradores a
  LEFT JOIN public.notas_manutencao n
    ON n.administrador_id = a.id
  WHERE a.role = 'admin'
    AND a.ativo = true
    AND a.em_ferias = false
  GROUP BY a.id, a.nome
  ORDER BY
    COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) ASC,
    a.nome ASC
  LIMIT 1;

  RETURN v_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2) REGISTRO DE ORDEM COM FALLBACK DE RESPONSAVEL
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(
  p_sync_id UUID
)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER) AS $$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_detectadas INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
  v_responsavel_atual_id UUID;
BEGIN
  FOR v_nota IN
    SELECT
      n.id,
      n.numero_nota,
      n.administrador_id,
      n.centro,
      n.status,
      n.data_criacao_sap,
      n.created_at,
      n.ordem_sap,
      n.ordem_gerada,
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        OR o.centro IS DISTINCT FROM n.centro
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
        OR n.administrador_id IS NULL
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;
    v_responsavel_atual_id := v_nota.administrador_id;

    IF v_responsavel_atual_id IS NULL THEN
      v_responsavel_atual_id := public.pick_fallback_admin_for_order(v_nota.centro);

      IF v_responsavel_atual_id IS NOT NULL THEN
        UPDATE public.notas_manutencao
        SET
          administrador_id = v_responsavel_atual_id,
          distribuida_em = COALESCE(distribuida_em, now()),
          updated_at = now()
        WHERE id = v_nota.id
          AND administrador_id IS NULL;

        IF FOUND THEN
          INSERT INTO public.notas_historico (
            nota_id,
            campo_alterado,
            valor_anterior,
            valor_novo,
            alterado_por,
            motivo
          )
          VALUES (
            v_nota.id,
            'administrador_id',
            'NULL',
            v_responsavel_atual_id::TEXT,
            NULL,
            'Fallback automatico ao virar ordem sem responsavel'
          );
        END IF;
      END IF;
    END IF;

    SELECT d.unidade
    INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro, '');

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (current_date - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
        0
      );

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id,
        numero_nota,
        ordem_codigo,
        administrador_id,
        centro,
        unidade,
        status_ordem,
        status_ordem_raw,
        ordem_detectada_em,
        status_atualizado_em,
        dias_para_gerar_ordem,
        sync_id
      )
      VALUES (
        v_nota.id,
        v_nota.numero_nota,
        v_ordem_codigo,
        v_responsavel_atual_id,
        v_nota.centro,
        v_unidade,
        'aberta',
        'ABERTO',
        now(),
        now(),
        v_dias_para_gerar,
        p_sync_id
      )
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        NULL,
        'aberta',
        'ABERTO',
        'detectada_na_nota',
        p_sync_id
      );

      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento
      SET
        nota_id = v_nota.id,
        numero_nota = v_nota.numero_nota,
        administrador_id = COALESCE(
          ordens_notas_acompanhamento.administrador_id,
          v_responsavel_atual_id
        ),
        centro = COALESCE(v_nota.centro, ordens_notas_acompanhamento.centro),
        unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
        sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
        updated_at = now()
      WHERE id = v_ordem.id;
    END IF;

    UPDATE public.notas_manutencao
    SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
      updated_at = now()
    WHERE id = v_nota.id
      AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

    IF v_nota.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao
      SET
        status = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
        updated_at = now()
      WHERE id = v_nota.id;

      INSERT INTO public.notas_historico (
        nota_id,
        campo_alterado,
        valor_anterior,
        valor_novo,
        alterado_por,
        motivo
      )
      VALUES (
        v_nota.id,
        'status',
        v_nota.status::TEXT,
        'concluida',
        NULL,
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_detectadas, v_auto_concluidas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3) BACKFILL LEGADO DE RESPONSAVEIS AUSENTES
-- ============================================================
DO $$
DECLARE
  v_item RECORD;
  v_destino UUID;
  v_notas_backfill INTEGER := 0;
  v_origens_backfill INTEGER := 0;
  v_gestor_id UUID;
BEGIN
  FOR v_item IN
    SELECT
      nm.id AS nota_id,
      COALESCE(nm.centro, o.centro) AS centro
    FROM public.ordens_notas_acompanhamento o
    JOIN public.notas_manutencao nm ON nm.id = o.nota_id
    WHERE nm.administrador_id IS NULL
    ORDER BY o.ordem_detectada_em ASC
  LOOP
    v_destino := public.pick_fallback_admin_for_order(v_item.centro);

    IF v_destino IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_destino,
      distribuida_em = COALESCE(distribuida_em, now()),
      updated_at = now()
    WHERE id = v_item.nota_id
      AND administrador_id IS NULL;

    IF FOUND THEN
      INSERT INTO public.notas_historico (
        nota_id,
        campo_alterado,
        valor_anterior,
        valor_novo,
        alterado_por,
        motivo
      )
      VALUES (
        v_item.nota_id,
        'administrador_id',
        'NULL',
        v_destino::TEXT,
        NULL,
        'Backfill fallback automatico para ordem sem responsavel'
      );
      v_notas_backfill := v_notas_backfill + 1;
    END IF;
  END LOOP;

  UPDATE public.ordens_notas_acompanhamento o
  SET
    administrador_id = nm.administrador_id,
    updated_at = now()
  FROM public.notas_manutencao nm
  WHERE nm.id = o.nota_id
    AND o.administrador_id IS NULL
    AND nm.administrador_id IS NOT NULL;

  GET DIAGNOSTICS v_origens_backfill = ROW_COUNT;

  IF to_regclass('public.admin_audit_log') IS NOT NULL
     AND (v_notas_backfill > 0 OR v_origens_backfill > 0) THEN
    SELECT a.id
    INTO v_gestor_id
    FROM public.administradores a
    WHERE a.role = 'gestor'
      AND a.ativo = true
    ORDER BY a.nome
    LIMIT 1;

    IF v_gestor_id IS NOT NULL THEN
      INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
      VALUES (
        v_gestor_id,
        'backfill_ordens_sem_responsavel',
        NULL,
        jsonb_build_object(
          'notas_backfill', v_notas_backfill,
          'origens_backfill', v_origens_backfill,
          'motivo', 'Fallback automatico para eliminar ordens sem responsavel'
        )
      );
    END IF;
  END IF;
END;
$$;
