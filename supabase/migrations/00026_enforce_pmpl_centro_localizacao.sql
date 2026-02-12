-- 00026_enforce_pmpl_centro_localizacao.sql
-- Garante que centro/unidade de ordens venham da PMPL (CENTRO_LOCALIZACAO),
-- sem popular esses campos a partir da nota no registro inicial da ordem.

CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(
  p_sync_id UUID
)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER) AS $$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
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
        NULL,
        NULL,
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
