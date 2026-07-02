-- 00300_fix_registrar_ordens_convergencia.sql
--
-- Fase 2 do diagnóstico de performance (2026-07-01). Causa raiz dos 9,8s
-- médios (máx 1h48) do pipeline de sync e do bloat de ordens_notas_acompanhamento
-- (76MB para 48k linhas):
--
-- 1. registrar_ordens_por_notas / registrar_ordem_da_nota NUNCA convergem.
--    O predicado do loop tem `o.administrador_id IS DISTINCT FROM n.administrador_id`;
--    quando a nota tem administrador_id = NULL e a ordem recebeu admin via
--    resolve_admin_ordem_sem_nota (ou é PMPL com dono próprio), a condição é
--    verdadeira PARA SEMPRE -> a cada sync a mesma nota re-entra no loop e a
--    ordem sofre SELECT FOR UPDATE + UPDATE SET updated_at = now() sem mudança
--    real. Milhares de writes inúteis por sync = tempo + dead tuples.
--    Fix: a condição só dispara quando a NOTA tem admin definido
--    (`n.administrador_id IS NOT NULL AND ...`) — nota sem admin não força
--    reprocesso; a ordem mantém o admin que já tem.
--
-- 2. UPDATE do branch ELSE era incondicional. Fix: no-op guard — só escreve
--    quando algum campo realmente muda.
--
-- ⚠️ Mudança de comportamento (intencional, alinhada à regra "não
-- auto-redistribuir ordens existentes"): o override CD 104 + equipamento ->
-- Daniel deixa de ser re-aplicado a cada sync para ordens cuja nota não tem
-- admin. Ele continua valendo na criação da ordem e quando a nota tem admin.
-- Antes, uma realocação manual dessas ordens era desfeita silenciosamente
-- pelo sync seguinte.
--
-- 3. normalizar_status_ordem: era LANGUAGE plpgsql — não-inlinável, chamada
--    por linha em vw_ordens_notas_painel. Convertida para LANGUAGE sql
--    (inlinável pelo planner), mesma semântica, mesmo tipo de retorno.

-- ============================================================
-- 1. registrar_ordens_por_notas (base: definição de produção pós-00248,
--    com override CD Manaus inline)
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id uuid)
RETURNS TABLE(ordens_detectadas integer, notas_auto_concluidas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por UUID;
  v_admin_efetivo UUID;
  v_admin_daniel UUID;
  v_centro_manaus BOOLEAN;
  v_detectadas INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
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
      n.criado_por_sap,
      n.descricao,
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        -- Convergência: nota sem admin não força reprocesso perpétuo.
        OR (n.administrador_id IS NOT NULL AND o.administrador_id IS DISTINCT FROM n.administrador_id)
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

    SELECT d.unidade
    INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro, '');

    SELECT m.administrador_id
    INTO v_criado_por
    FROM public.sap_user_admin_map m
    WHERE m.sap_codigo = v_nota.criado_por_sap;

    -- Detecta CD Manaus
    v_centro_manaus := COALESCE(v_unidade ILIKE '%MANAUS%', false)
                       OR COALESCE(v_nota.centro = '104', false);

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (CURRENT_DATE - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
        0
      );

      v_admin_efetivo := COALESCE(
        v_nota.administrador_id,
        public.resolve_admin_ordem_sem_nota(v_nota.centro, v_unidade, v_nota.descricao)
      );

      -- Override: CD MANAUS + equipamento → Daniel (cd_manaus_equip)
      IF v_centro_manaus AND public.is_cd_manaus_equipamento(v_nota.descricao) THEN
        SELECT a.id INTO v_admin_daniel
        FROM public.administradores a
        WHERE a.especialidade = 'cd_manaus_equip'
          AND a.ativo = true
          AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        LIMIT 1;
        IF v_admin_daniel IS NOT NULL THEN
          v_admin_efetivo := v_admin_daniel;
        END IF;
      END IF;

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id, numero_nota, ordem_codigo, administrador_id, criado_por,
        centro, unidade, status_ordem_raw, ordem_detectada_em,
        status_atualizado_em, dias_para_gerar_ordem, sync_id
      )
      VALUES (
        v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_admin_efetivo, v_criado_por,
        v_nota.centro, v_unidade, 'ABERTO', now(),
        now(), v_dias_para_gerar, p_sync_id
      )
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico (
        ordem_id, status_anterior, status_novo, status_raw, origem, sync_id
      )
      VALUES (
        v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id
      );

      v_detectadas := v_detectadas + 1;
    ELSE
      -- Para ordens existentes: resolve admin com mesmo override
      v_admin_efetivo := CASE
        WHEN v_nota.administrador_id IS NOT NULL
          THEN v_nota.administrador_id
        WHEN v_ordem.administrador_id IS NOT NULL
          THEN v_ordem.administrador_id
        ELSE public.resolve_admin_ordem_sem_nota(
          COALESCE(NULLIF(BTRIM(v_ordem.centro), ''), v_nota.centro),
          NULLIF(BTRIM(v_ordem.unidade), ''),
          v_nota.descricao
        )
      END;

      -- Override: CD MANAUS + equipamento → Daniel
      IF v_centro_manaus AND public.is_cd_manaus_equipamento(v_nota.descricao) THEN
        SELECT a.id INTO v_admin_daniel
        FROM public.administradores a
        WHERE a.especialidade = 'cd_manaus_equip'
          AND a.ativo = true
          AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        LIMIT 1;
        IF v_admin_daniel IS NOT NULL THEN
          v_admin_efetivo := v_admin_daniel;
        END IF;
      END IF;

      -- No-op guard: só escreve quando algo realmente muda (evita dead tuples
      -- e tempo de lock em ordens que já estão corretas).
      UPDATE public.ordens_notas_acompanhamento
      SET
        nota_id      = v_nota.id,
        numero_nota  = v_nota.numero_nota,
        administrador_id = v_admin_efetivo,
        criado_por   = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
        centro       = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
        unidade      = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''), v_unidade),
        sync_id      = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
        updated_at   = now()
      WHERE id = v_ordem.id
        AND (
          v_ordem.nota_id IS DISTINCT FROM v_nota.id
          OR v_ordem.numero_nota IS DISTINCT FROM v_nota.numero_nota
          OR v_ordem.administrador_id IS DISTINCT FROM v_admin_efetivo
          OR (v_ordem.criado_por IS NULL AND v_criado_por IS NOT NULL)
          OR (NULLIF(BTRIM(v_ordem.centro), '') IS NULL AND v_nota.centro IS NOT NULL)
          OR (NULLIF(BTRIM(v_ordem.unidade), '') IS NULL AND v_unidade IS NOT NULL)
        );
    END IF;

    UPDATE public.notas_manutencao
    SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
      updated_at   = now()
    WHERE id = v_nota.id
      AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

    IF v_nota.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao
      SET
        status       = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
        updated_at   = now()
      WHERE id = v_nota.id;

      INSERT INTO public.notas_historico (
        nota_id, campo_alterado, valor_anterior, valor_novo, motivo
      )
      VALUES (
        v_nota.id, 'status', v_nota.status::TEXT, 'concluida',
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_detectadas, v_auto_concluidas;
END;
$function$;

COMMENT ON FUNCTION public.registrar_ordens_por_notas(uuid) IS
  'Detecta/atualiza ordens a partir de notas com ordem_sap/ordem_gerada. '
  'Convergente desde 00300: nota sem admin não força reprocesso; UPDATE só quando há mudança real.';

-- ============================================================
-- 2. registrar_ordem_da_nota (mesmos fixes, versão single-nota)
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordem_da_nota(p_nota_id uuid, p_sync_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(ordens_detectadas integer, notas_auto_concluidas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por UUID;
  v_admin_efetivo UUID;
BEGIN
  ordens_detectadas := 0;
  notas_auto_concluidas := 0;

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
    n.criado_por_sap,
    n.descricao,
    COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
  INTO v_nota
  FROM public.notas_manutencao n
  LEFT JOIN public.ordens_notas_acompanhamento o
    ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
  WHERE n.id = p_nota_id
    AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
    AND (
      o.id IS NULL
      OR o.nota_id IS DISTINCT FROM n.id
      -- Convergência: nota sem admin não força reprocesso perpétuo.
      OR (n.administrador_id IS NOT NULL AND o.administrador_id IS DISTINCT FROM n.administrador_id)
      OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT ordens_detectadas, notas_auto_concluidas;
    RETURN;
  END IF;

  v_ordem_codigo := v_nota.ordem_codigo;

  SELECT d.unidade INTO v_unidade
  FROM public.dim_centro_unidade d
  WHERE d.centro = COALESCE(v_nota.centro, '');

  SELECT m.administrador_id INTO v_criado_por
  FROM public.sap_user_admin_map m
  WHERE m.sap_codigo = v_nota.criado_por_sap;

  SELECT *
  INTO v_ordem
  FROM public.ordens_notas_acompanhamento o
  WHERE o.ordem_codigo = v_ordem_codigo
  FOR UPDATE;

  IF NOT FOUND THEN
    v_dias_para_gerar := GREATEST(
      (CURRENT_DATE - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
      0
    );

    v_admin_efetivo := COALESCE(
      v_nota.administrador_id,
      public.resolve_admin_ordem_sem_nota(
        v_nota.centro::TEXT,
        v_unidade::TEXT,
        v_nota.descricao::TEXT
      )
    );

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id, numero_nota, ordem_codigo, administrador_id, criado_por,
      centro, unidade, status_ordem_raw, ordem_detectada_em,
      status_atualizado_em, dias_para_gerar_ordem, sync_id
    )
    VALUES (
      v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_admin_efetivo, v_criado_por,
      v_nota.centro, v_unidade, 'ABERTO', now(),
      now(), v_dias_para_gerar, p_sync_id
    )
    RETURNING * INTO v_ordem;

    INSERT INTO public.ordens_notas_historico (
      ordem_id, status_anterior, status_novo, status_raw, origem, sync_id
    )
    VALUES (
      v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id
    );

    ordens_detectadas := ordens_detectadas + 1;
  ELSE
    v_admin_efetivo := CASE
      WHEN v_nota.administrador_id IS NOT NULL
        THEN v_nota.administrador_id
      WHEN v_ordem.administrador_id IS NOT NULL
        THEN v_ordem.administrador_id
      ELSE public.resolve_admin_ordem_sem_nota(
        COALESCE(NULLIF(BTRIM(v_ordem.centro), ''), v_nota.centro)::TEXT,
        NULLIF(BTRIM(v_ordem.unidade), '')::TEXT,
        v_nota.descricao::TEXT
      )
    END;

    -- No-op guard: só escreve quando algo realmente muda.
    UPDATE public.ordens_notas_acompanhamento
    SET
      nota_id = v_nota.id,
      numero_nota = v_nota.numero_nota,
      administrador_id = v_admin_efetivo,
      criado_por = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
      centro = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
      unidade = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''), v_unidade),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now()
    WHERE id = v_ordem.id
      AND (
        v_ordem.nota_id IS DISTINCT FROM v_nota.id
        OR v_ordem.numero_nota IS DISTINCT FROM v_nota.numero_nota
        OR v_ordem.administrador_id IS DISTINCT FROM v_admin_efetivo
        OR (v_ordem.criado_por IS NULL AND v_criado_por IS NOT NULL)
        OR (NULLIF(BTRIM(v_ordem.centro), '') IS NULL AND v_nota.centro IS NOT NULL)
        OR (NULLIF(BTRIM(v_ordem.unidade), '') IS NULL AND v_unidade IS NOT NULL)
      );
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
      nota_id, campo_alterado, valor_anterior, valor_novo, motivo
    )
    VALUES (
      v_nota.id, 'status', v_nota.status::TEXT, 'concluida',
      'Auto conclusao: ordem identificada no sync'
    );

    notas_auto_concluidas := notas_auto_concluidas + 1;
  END IF;

  RETURN QUERY SELECT ordens_detectadas, notas_auto_concluidas;
END;
$function$;

COMMENT ON FUNCTION public.registrar_ordem_da_nota(uuid, uuid) IS
  'Versão single-nota de registrar_ordens_por_notas. '
  'Convergente desde 00300: nota sem admin não força reprocesso; UPDATE só quando há mudança real.';

-- ============================================================
-- 3. normalizar_status_ordem: plpgsql → sql (inlinável pelo planner;
--    era chamada por linha em vw_ordens_notas_painel sem inline)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalizar_status_ordem(p_raw text)
RETURNS ordem_status_acomp
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN UPPER(BTRIM(COALESCE(p_raw, ''))) = '' THEN 'desconhecido'::ordem_status_acomp
    WHEN UPPER(BTRIM(COALESCE(p_raw, ''))) = 'ABERTO' THEN 'aberta'::ordem_status_acomp
    WHEN UPPER(BTRIM(COALESCE(p_raw, ''))) IN (
      'EM_PROCESSAMENTO', 'EM_EXECUCAO', 'AVALIACAO_DA_EXECUCAO',
      'EQUIPAMENTO_EM_CONSERTO', 'EXECUCAO_NAO_REALIZADA', 'ENVIAR_EMAIL_PFORNECEDOR',
      'EXECUCAO_INSATISFATORIO'
    ) THEN 'em_tratativa'::ordem_status_acomp
    WHEN UPPER(BTRIM(COALESCE(p_raw, ''))) IN (
      'CONCLUIDO', 'AGUARDANDO_FATURAMENTO_NF', 'EXECUCAO_SATISFATORIO'
    ) THEN 'concluida'::ordem_status_acomp
    WHEN UPPER(BTRIM(COALESCE(p_raw, ''))) = 'CANCELADO' THEN 'cancelada'::ordem_status_acomp
    ELSE 'desconhecido'::ordem_status_acomp
  END;
$$;
