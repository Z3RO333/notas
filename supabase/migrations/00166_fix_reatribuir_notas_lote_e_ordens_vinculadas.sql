-- 00166_fix_reatribuir_notas_lote_e_ordens_vinculadas.sql
--
-- Corrige dois problemas na redistribuicao de ferias:
--
-- 1) reatribuir_notas_lote: ambiguidade "nota_id" entre a variavel de retorno
--    (RETURNS TABLE) e o alias do SELECT no FOR loop, causando erro 42702 que
--    era silenciado pelo EXCEPTION em redistribuir_carteira_ferias.
--    Fix: remove alias 'AS nota_id' do SELECT → usa v_nota.id diretamente.
--
-- 2) redistribuir_carteira_ferias: ordens vinculadas a notas (nota_id IS NOT NULL)
--    nao eram redistribuidas. Apos reatribuir as notas, sincroniza
--    ordens_notas_acompanhamento.administrador_id para refletir o novo admin da nota.

-- ============================================================
-- 1) Corrige reatribuir_notas_lote
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
    RAISE EXCEPTION 'Gestor inválido para reatribuição em lote';
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido. Use destino_unico ou round_robin';
  END IF;

  PERFORM 1
  FROM public.administradores a
  WHERE a.id = p_admin_origem
    AND a.role = 'admin';

  IF NOT FOUND THEN
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
    SELECT array_agg(a.id ORDER BY a.nome) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false
      AND a.id <> p_admin_origem;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Não existem destinos elegíveis para round_robin';
    END IF;
  END IF;

  -- FIX: SELECT sem alias 'AS nota_id' para evitar ambiguidade com a
  -- variavel de retorno RETURNS TABLE(nota_id UUID, ...).
  -- Usa nm.id diretamente → v_nota.id em todos os acessos.
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
-- 2) Corrige redistribuir_carteira_ferias:
--    apos redistribuir notas, sincroniza administrador_id das
--    ordens vinculadas a essas notas.
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

  -- Redistribui notas abertas via round_robin
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

    -- Sincroniza ordens vinculadas a notas ja redistribuidas:
    -- apos reatribuir_notas_lote, a nota.administrador_id mudou;
    -- atualiza ordens_notas_acompanhamento para refletir o novo admin.
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
          AND o.status_ordem::TEXT NOT IN ('concluida', 'cancelada')
        RETURNING o.id
      )
      SELECT COUNT(*)::INTEGER INTO v_ordens_vinculadas FROM sync;
    EXCEPTION
      WHEN OTHERS THEN
        v_ordens_vinculadas := 0;
    END;
  END IF;

  -- Reseta ordens standalone (sem nota) do admin
  WITH reset AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      administrador_id = NULL,
      updated_at = now()
    WHERE o.nota_id IS NULL
      AND o.administrador_id = p_admin_origem
      AND o.status_ordem::TEXT NOT IN ('concluida', 'cancelada')
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
  'Redistribui a carteira aberta do admin ao iniciar ferias: notas abertas (round_robin), ordens vinculadas a notas (sync com novo admin), ordens standalone (reset + reatribuicao).';
