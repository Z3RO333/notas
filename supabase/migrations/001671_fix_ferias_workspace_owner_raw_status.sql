-- 00167_fix_ferias_workspace_owner_raw_status.sql
--
-- Corrige redistribuicao de ferias para usar status_ordem_raw como fonte
-- de verdade e limpar ordens PMOS vinculadas a notas concluidas que ainda
-- aparecem no workspace do admin em ferias.

-- ============================================================
-- 1) Reatribuir notas em lote sem ambiguidade de nota_id
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
BEGIN
  PERFORM 1
  FROM public.administradores g
  WHERE g.id = p_gestor_id
    AND g.role = 'gestor'
    AND g.ativo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gestor invalido para reatribuicao em lote';
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo invalido. Use destino_unico ou round_robin';
  END IF;

  PERFORM 1
  FROM public.administradores a
  WHERE a.id = p_admin_origem
    AND a.role = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin de origem invalido';
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
      RAISE EXCEPTION 'Destino unico invalido';
    END IF;
  ELSE
    SELECT array_agg(a.id ORDER BY a.nome)
    INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.id <> p_admin_origem;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Nao existem destinos elegiveis para round_robin';
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
      COALESCE(v_nota.administrador_id::TEXT, 'NULL'),
      v_destino::TEXT,
      p_gestor_id,
      COALESCE(p_motivo, 'Reatribuicao em lote pelo gestor (' || p_modo || ')')
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
-- 2) Redistribuicao de ferias baseada em status_raw
-- ============================================================
CREATE OR REPLACE FUNCTION public.redistribuir_carteira_ferias(
  p_admin_origem UUID,
  p_gestor_id UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(
  gestor_utilizado UUID,
  notas_reatribuidas INTEGER,
  ordens_vinculadas_sincronizadas INTEGER,
  ordens_standalone_resetadas INTEGER,
  ordens_standalone_preenchidas INTEGER,
  ordens_pmpl_standalone_realinhadas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gestor_id UUID;
  v_notas_reatribuidas INTEGER := 0;
  v_ordens_vinculadas INTEGER := 0;
  v_ordens_vinculadas_abertas INTEGER := 0;
  v_notas_workspace_realinhadas INTEGER := 0;
  v_ordens_workspace_realinhadas INTEGER := 0;
  v_workspace_destinos_preservados INTEGER := 0;
  v_workspace_destinos_round_robin INTEGER := 0;
  v_ordens_resetadas INTEGER := 0;
  v_ordens_preenchidas INTEGER := 0;
  v_ordens_pmpl_realinhadas INTEGER := 0;
  v_admin_valido BOOLEAN := false;
  v_tem_destino_notas BOOLEAN := false;
  v_result_standalone RECORD;
  v_result_pmpl RECORD;
BEGIN
  SELECT true
  INTO v_admin_valido
  FROM public.administradores a
  WHERE a.id = p_admin_origem
    AND a.role = 'admin'
    AND a.ativo = true
  LIMIT 1;

  IF COALESCE(v_admin_valido, false) = false THEN
    RAISE EXCEPTION 'Admin de origem invalido para redistribuicao de ferias';
  END IF;

  v_gestor_id := p_gestor_id;

  IF v_gestor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.administradores g
    WHERE g.id = v_gestor_id
      AND g.role = 'gestor'
      AND g.ativo = true;

    IF NOT FOUND THEN
      v_gestor_id := NULL;
    END IF;
  END IF;

  IF v_gestor_id IS NULL THEN
    SELECT g.id
    INTO v_gestor_id
    FROM public.administradores g
    WHERE g.role = 'gestor'
      AND g.ativo = true
    ORDER BY g.nome
    LIMIT 1;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.id <> p_admin_origem
  )
  INTO v_tem_destino_notas;

  IF v_gestor_id IS NOT NULL AND v_tem_destino_notas THEN
    BEGIN
      SELECT COUNT(*)::INTEGER
      INTO v_notas_reatribuidas
      FROM public.reatribuir_notas_lote(
        p_admin_origem,
        v_gestor_id,
        'round_robin',
        NULL,
        COALESCE(p_motivo, 'Redistribuicao automatica ao iniciar ferias')
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_notas_reatribuidas := 0;
    END;

    BEGIN
      WITH sync AS (
        UPDATE public.ordens_notas_acompanhamento o
        SET
          administrador_id = nm.administrador_id,
          updated_at = now()
        FROM public.notas_manutencao nm
        WHERE o.nota_id = nm.id
          AND o.administrador_id = p_admin_origem
          AND nm.administrador_id <> p_admin_origem
          AND public.status_raw_eh_ativo(o.status_ordem_raw)
          AND NOT public.status_raw_eh_final(o.status_ordem_raw)
        RETURNING o.id
      )
      SELECT COUNT(*)::INTEGER
      INTO v_ordens_vinculadas_abertas
      FROM sync;
    EXCEPTION
      WHEN OTHERS THEN
        v_ordens_vinculadas_abertas := 0;
    END;

    BEGIN
      WITH eligible_admins AS (
        SELECT
          a.id,
          (ROW_NUMBER() OVER (ORDER BY a.nome) - 1)::INTEGER AS rn,
          COUNT(*) OVER ()::INTEGER AS total
        FROM public.administradores a
        WHERE a.role = 'admin'
          AND a.ativo = true
          AND a.em_ferias = false
          AND a.id <> p_admin_origem
      ),
      workspace_linked_orders AS (
        SELECT
          v.nota_id,
          v.ordem_id,
          o.administrador_id AS ordem_admin_id,
          o.updated_at,
          o.ordem_detectada_em
        FROM public.vw_ordens_notas_painel v
        JOIN public.ordens_notas_acompanhamento o
          ON o.id = v.ordem_id
        WHERE v.nota_id IS NOT NULL
          AND v.responsavel_atual_id = p_admin_origem
          AND COALESCE(NULLIF(BTRIM(v.tipo_ordem), ''), 'PMOS') <> 'PMPL'
          AND public.status_raw_eh_ativo(v.status_ordem_raw)
          AND NOT public.status_raw_eh_final(v.status_ordem_raw)
      ),
      candidate_notes AS (
        SELECT
          w.nota_id,
          nm.administrador_id AS current_note_admin_id,
          MAX(w.ordem_detectada_em) AS last_ordem_detectada_em
        FROM workspace_linked_orders w
        JOIN public.notas_manutencao nm
          ON nm.id = w.nota_id
        GROUP BY w.nota_id, nm.administrador_id
      ),
      preserved_destination_counts AS (
        SELECT
          w.nota_id,
          COUNT(DISTINCT w.ordem_admin_id)::INTEGER AS distinct_destinations
        FROM workspace_linked_orders w
        JOIN public.administradores a
          ON a.id = w.ordem_admin_id
        WHERE w.ordem_admin_id IS NOT NULL
          AND w.ordem_admin_id <> p_admin_origem
          AND a.role = 'admin'
          AND a.ativo = true
          AND a.em_ferias = false
        GROUP BY w.nota_id
      ),
      preserved_destination_ranked AS (
        SELECT
          w.nota_id,
          w.ordem_admin_id AS destino_id,
          ROW_NUMBER() OVER (
            PARTITION BY w.nota_id
            ORDER BY w.updated_at DESC NULLS LAST, w.ordem_detectada_em DESC NULLS LAST, w.ordem_id DESC
          )::INTEGER AS rn
        FROM workspace_linked_orders w
        JOIN public.administradores a
          ON a.id = w.ordem_admin_id
        WHERE w.ordem_admin_id IS NOT NULL
          AND w.ordem_admin_id <> p_admin_origem
          AND a.role = 'admin'
          AND a.ativo = true
          AND a.em_ferias = false
      ),
      preserved_destinations AS (
        SELECT
          r.nota_id,
          r.destino_id,
          c.distinct_destinations
        FROM preserved_destination_ranked r
        JOIN preserved_destination_counts c
          ON c.nota_id = r.nota_id
        WHERE r.rn = 1
      ),
      rr_candidates AS (
        SELECT
          c.nota_id,
          (ROW_NUMBER() OVER (ORDER BY c.last_ordem_detectada_em NULLS LAST, c.nota_id) - 1)::INTEGER AS rr_index
        FROM candidate_notes c
        LEFT JOIN preserved_destinations p
          ON p.nota_id = c.nota_id
        WHERE p.nota_id IS NULL
      ),
      note_destinations AS (
        SELECT
          c.nota_id,
          c.current_note_admin_id,
          COALESCE(p.destino_id, e.id) AS destino_id
        FROM candidate_notes c
        LEFT JOIN preserved_destinations p
          ON p.nota_id = c.nota_id
        LEFT JOIN rr_candidates rr
          ON rr.nota_id = c.nota_id
        LEFT JOIN eligible_admins e
          ON rr.nota_id IS NOT NULL
         AND e.rn = (rr.rr_index % e.total)
      ),
      notes_history AS (
        INSERT INTO public.notas_historico (
          nota_id,
          campo_alterado,
          valor_anterior,
          valor_novo,
          alterado_por,
          motivo
        )
        SELECT
          d.nota_id,
          'administrador_id',
          COALESCE(d.current_note_admin_id::TEXT, 'NULL'),
          d.destino_id::TEXT,
          v_gestor_id,
          COALESCE(
            p_motivo,
            'Redistribuicao automatica ao iniciar ferias (ordens PMOS ativas em nota concluida)'
          )
        FROM note_destinations d
        WHERE d.destino_id IS NOT NULL
          AND d.current_note_admin_id IS DISTINCT FROM d.destino_id
        RETURNING 1
      ),
      notes_tracking AS (
        INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
        SELECT
          d.nota_id,
          d.current_note_admin_id,
          'reatribuicao_ferias_workspace'
        FROM note_destinations d
        WHERE d.destino_id IS NOT NULL
          AND d.current_note_admin_id IS NOT NULL
          AND d.current_note_admin_id IS DISTINCT FROM d.destino_id
        ON CONFLICT ON CONSTRAINT uq_nota_acompanhamentos_nota_admin DO NOTHING
        RETURNING 1
      ),
      notes_update AS (
        UPDATE public.notas_manutencao nm
        SET
          administrador_id = d.destino_id,
          updated_at = now()
        FROM note_destinations d
        WHERE nm.id = d.nota_id
          AND d.destino_id IS NOT NULL
          AND nm.administrador_id IS DISTINCT FROM d.destino_id
        RETURNING nm.id
      ),
      orders_update AS (
        UPDATE public.ordens_notas_acompanhamento o
        SET
          administrador_id = d.destino_id,
          updated_at = now()
        FROM note_destinations d
        WHERE o.nota_id = d.nota_id
          AND d.destino_id IS NOT NULL
          AND COALESCE(NULLIF(BTRIM(o.tipo_ordem), ''), 'PMOS') <> 'PMPL'
          AND public.status_raw_eh_ativo(o.status_ordem_raw)
          AND NOT public.status_raw_eh_final(o.status_ordem_raw)
          AND o.administrador_id IS DISTINCT FROM d.destino_id
        RETURNING o.id
      )
      SELECT
        COALESCE((SELECT COUNT(*)::INTEGER FROM notes_update), 0),
        COALESCE((SELECT COUNT(*)::INTEGER FROM orders_update), 0),
        COALESCE((SELECT COUNT(*)::INTEGER FROM preserved_destinations), 0),
        COALESCE((SELECT COUNT(*)::INTEGER FROM rr_candidates), 0)
      INTO
        v_notas_workspace_realinhadas,
        v_ordens_workspace_realinhadas,
        v_workspace_destinos_preservados,
        v_workspace_destinos_round_robin;
    EXCEPTION
      WHEN OTHERS THEN
        v_notas_workspace_realinhadas := 0;
        v_ordens_workspace_realinhadas := 0;
        v_workspace_destinos_preservados := 0;
        v_workspace_destinos_round_robin := 0;
    END;
  END IF;

  v_ordens_vinculadas := v_ordens_vinculadas_abertas + v_ordens_workspace_realinhadas;

  WITH reset AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      administrador_id = NULL,
      updated_at = now()
    WHERE o.nota_id IS NULL
      AND o.administrador_id = p_admin_origem
      AND public.status_raw_eh_ativo(o.status_ordem_raw)
      AND NOT public.status_raw_eh_final(o.status_ordem_raw)
    RETURNING o.id
  )
  SELECT COUNT(*)::INTEGER
  INTO v_ordens_resetadas
  FROM reset;

  BEGIN
    SELECT *
    INTO v_result_standalone
    FROM public.atribuir_responsavel_ordens_standalone();

    v_ordens_preenchidas := COALESCE(v_result_standalone.responsaveis_preenchidos, 0);
  EXCEPTION
    WHEN OTHERS THEN
      v_ordens_preenchidas := 0;
  END;

  IF to_regprocedure('public.realinhar_responsavel_pmpl_standalone()') IS NOT NULL THEN
    BEGIN
      SELECT *
      INTO v_result_pmpl
      FROM public.realinhar_responsavel_pmpl_standalone();

      v_ordens_pmpl_realinhadas := COALESCE(v_result_pmpl.reatribuicoes, 0);
    EXCEPTION
      WHEN OTHERS THEN
        v_ordens_pmpl_realinhadas := 0;
    END;
  END IF;

  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.admin_audit_log (gestor_id, acao, alvo_id, detalhes)
      VALUES (
        v_gestor_id,
        'auto_redistribuir_ferias_carteira',
        p_admin_origem,
        jsonb_build_object(
          'motivo', COALESCE(p_motivo, 'Redistribuicao automatica ao iniciar ferias'),
          'notas_reatribuidas', v_notas_reatribuidas,
          'ordens_vinculadas_sincronizadas', v_ordens_vinculadas,
          'ordens_vinculadas_sincronizadas_abertas', v_ordens_vinculadas_abertas,
          'notas_workspace_realinhadas', v_notas_workspace_realinhadas,
          'ordens_workspace_realinhadas', v_ordens_workspace_realinhadas,
          'workspace_destinos_preservados', v_workspace_destinos_preservados,
          'workspace_destinos_round_robin', v_workspace_destinos_round_robin,
          'ordens_standalone_resetadas', v_ordens_resetadas,
          'ordens_standalone_preenchidas', v_ordens_preenchidas,
          'ordens_pmpl_standalone_realinhadas', v_ordens_pmpl_realinhadas
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  RETURN QUERY
  SELECT
    v_gestor_id,
    v_notas_reatribuidas,
    v_ordens_vinculadas,
    v_ordens_resetadas,
    v_ordens_preenchidas,
    v_ordens_pmpl_realinhadas;
END;
$$;

COMMENT ON FUNCTION public.redistribuir_carteira_ferias(UUID, UUID, TEXT) IS
  'Redistribui a carteira aberta do admin ao iniciar ferias usando status_ordem_raw como fonte de verdade: notas abertas, ordens PMOS vinculadas a notas ainda visiveis no workspace, ordens standalone e PMPL standalone.';
