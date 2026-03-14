-- 00165_auto_redistribuir_ferias_carteira.sql
--
-- Garante que, ao iniciar ferias, a carteira aberta do admin seja redistribuida:
--   1. Notas abertas -> round robin entre admins elegiveis
--   2. Ordens standalone do admin -> reset + reatribuicao automatica
--   3. PMPL standalone -> realinhamento para responsavel/substituto configurado
-- A mesma funcao tambem passa a ser usada pelo cron de auto_aplicar_ferias().

CREATE OR REPLACE FUNCTION public.redistribuir_carteira_ferias(
  p_admin_origem UUID,
  p_gestor_id UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(
  gestor_utilizado UUID,
  notas_reatribuidas INTEGER,
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
  END IF;

  WITH reset AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      administrador_id = NULL,
      updated_at = now()
    WHERE o.nota_id IS NULL
      AND o.administrador_id = p_admin_origem
      AND COALESCE(NULLIF(BTRIM(o.status_ordem), ''), '') NOT IN ('concluida', 'cancelada')
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
    v_ordens_resetadas,
    v_ordens_preenchidas,
    v_ordens_pmpl_realinhadas;
END;
$$;

COMMENT ON FUNCTION public.redistribuir_carteira_ferias(UUID, UUID, TEXT) IS
  'Redistribui automaticamente a carteira aberta do admin ao iniciar ferias: notas abertas, ordens standalone e PMPL standalone.';

CREATE OR REPLACE FUNCTION public.auto_aplicar_ferias()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  FOR v_admin IN
    UPDATE public.administradores
    SET
      em_ferias = true,
      updated_at = now()
    WHERE ativo = true
      AND em_ferias = false
      AND data_inicio_ferias IS NOT NULL
      AND data_inicio_ferias <= CURRENT_DATE
      AND (data_fim_ferias IS NULL OR data_fim_ferias >= CURRENT_DATE)
    RETURNING id
  LOOP
    PERFORM *
    FROM public.redistribuir_carteira_ferias(
      v_admin.id,
      NULL,
      'Redistribuicao automatica pelo cron ao iniciar ferias'
    );
  END LOOP;

  UPDATE public.administradores
  SET
    em_ferias = false,
    updated_at = now()
  WHERE ativo = true
    AND em_ferias = true
    AND data_fim_ferias IS NOT NULL
    AND data_fim_ferias < CURRENT_DATE;
END;
$$;

COMMENT ON FUNCTION public.auto_aplicar_ferias() IS
  'Ativa/desativa ferias automaticamente por data e redistribui a carteira aberta ao iniciar ferias.';
