-- 00193_auto_registrar_ordem_ao_receber_codigo_na_nota.sql
--
-- Problema:
-- Quando notas_manutencao.ordem_sap e preenchido, a nota sai de vw_notas_sem_ordem
-- imediatamente, mas a linha correspondente em ordens_notas_acompanhamento so
-- aparece quando algum sync posterior executa registrar_ordens_por_notas().
-- Isso cria um limbo operacional: a nota some do painel de notas e ainda nao
-- entra no painel de ordens.
--
-- Solucao:
-- 1. Extrai a materializacao da ordem para um helper pontual por nota
-- 2. Dispara esse helper automaticamente no momento em que ordem_sap/ordem_gerada
--    surge ou muda na nota
-- 3. Executa um backfill unico para cobrir notas que ja estavam no limbo

CREATE OR REPLACE FUNCTION public.registrar_ordem_da_nota(
  p_nota_id UUID,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
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
      OR o.administrador_id IS DISTINCT FROM n.administrador_id
      OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
    );

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT ordens_detectadas, notas_auto_concluidas;
    RETURN;
  END IF;

  v_ordem_codigo := v_nota.ordem_codigo;

  SELECT d.unidade
  INTO v_unidade
  FROM public.dim_centro_unidade d
  WHERE d.centro = COALESCE(v_nota.centro, '');

  SELECT m.administrador_id
  INTO v_criado_por
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
        NULL::TEXT
      )
    );

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      numero_nota,
      ordem_codigo,
      administrador_id,
      criado_por,
      centro,
      unidade,
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
      v_admin_efetivo,
      v_criado_por,
      v_nota.centro,
      v_unidade,
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

    ordens_detectadas := ordens_detectadas + 1;
  ELSE
    UPDATE public.ordens_notas_acompanhamento
    SET
      nota_id = v_nota.id,
      numero_nota = v_nota.numero_nota,
      administrador_id = CASE
        WHEN v_nota.administrador_id IS NOT NULL
          THEN v_nota.administrador_id
        WHEN ordens_notas_acompanhamento.administrador_id IS NOT NULL
          THEN ordens_notas_acompanhamento.administrador_id
        ELSE public.resolve_admin_ordem_sem_nota(
          COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro)::TEXT,
          NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), '')::TEXT,
          NULL::TEXT
        )
      END,
      criado_por = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
      centro = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
      unidade = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''), v_unidade),
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
      motivo
    )
    VALUES (
      v_nota.id,
      'status',
      v_nota.status::TEXT,
      'concluida',
      'Auto conclusao: ordem identificada no sync'
    );

    notas_auto_concluidas := notas_auto_concluidas + 1;
  END IF;

  RETURN QUERY
  SELECT ordens_detectadas, notas_auto_concluidas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_registrar_ordem_da_nota_quando_recebe_codigo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_ordem_codigo TEXT;
  v_new_ordem_codigo TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_ordem_codigo := NULL;
  ELSE
    v_old_ordem_codigo := COALESCE(
      NULLIF(BTRIM(OLD.ordem_sap), ''),
      NULLIF(BTRIM(OLD.ordem_gerada), '')
    );
  END IF;

  v_new_ordem_codigo := COALESCE(
    NULLIF(BTRIM(NEW.ordem_sap), ''),
    NULLIF(BTRIM(NEW.ordem_gerada), '')
  );

  IF v_new_ordem_codigo IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_old_ordem_codigo IS DISTINCT FROM v_new_ordem_codigo THEN
    PERFORM *
    FROM public.registrar_ordem_da_nota(NEW.id, NULL::UUID);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_registrar_ordem_da_nota_quando_recebe_codigo
  ON public.notas_manutencao;

CREATE TRIGGER trg_registrar_ordem_da_nota_quando_recebe_codigo
  AFTER INSERT OR UPDATE OF ordem_sap, ordem_gerada
  ON public.notas_manutencao
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_registrar_ordem_da_nota_quando_recebe_codigo();

COMMENT ON FUNCTION public.registrar_ordem_da_nota(UUID, UUID) IS
  'Materializa imediatamente a ordem vinculada a uma nota especifica em ordens_notas_acompanhamento.';

CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id UUID)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_result RECORD;
  v_ordens_detectadas INTEGER := 0;
  v_notas_auto_concluidas INTEGER := 0;
BEGIN
  FOR v_nota IN
    SELECT
      n.id
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
      )
  LOOP
    SELECT
      t.ordens_detectadas,
      t.notas_auto_concluidas
    INTO v_result
    FROM public.registrar_ordem_da_nota(v_nota.id, p_sync_id) t;

    v_ordens_detectadas := v_ordens_detectadas + COALESCE(v_result.ordens_detectadas, 0);
    v_notas_auto_concluidas := v_notas_auto_concluidas + COALESCE(v_result.notas_auto_concluidas, 0);
  END LOOP;

  RETURN QUERY
  SELECT v_ordens_detectadas, v_notas_auto_concluidas;
END;
$function$;

COMMENT ON FUNCTION public.registrar_ordens_por_notas(UUID) IS
  'Materializa ordens vinculadas a notas em lote, reutilizando o helper pontual registrar_ordem_da_nota().';

CREATE OR REPLACE FUNCTION public.backfill_ordens_nota_sem_responsavel()
RETURNS TABLE(total_candidatas INTEGER, atribuidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ordem RECORD;
  v_destino UUID;
  v_total INTEGER := 0;
  v_atribuidas INTEGER := 0;
BEGIN
  FOR v_ordem IN
    SELECT o.id, o.centro, o.unidade
    FROM public.ordens_notas_acompanhamento o
    JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE o.nota_id IS NOT NULL
      AND o.administrador_id IS NULL
      AND n.administrador_id IS NULL
      AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  LOOP
    v_total := v_total + 1;
    v_destino := public.resolve_admin_ordem_sem_nota(
      v_ordem.centro::TEXT,
      v_ordem.unidade::TEXT,
      NULL::TEXT
    );

    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET administrador_id = v_destino, updated_at = now()
      WHERE id = v_ordem.id;
      v_atribuidas := v_atribuidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_total, v_atribuidas;
END;
$function$;

COMMENT ON FUNCTION public.backfill_ordens_nota_sem_responsavel() IS
  'Reaplica o fallback de responsavel para ordens vinculadas a nota usando a assinatura atual de resolve_admin_ordem_sem_nota().';

COMMENT ON FUNCTION public.trg_registrar_ordem_da_nota_quando_recebe_codigo() IS
  'Trigger para criar/atualizar ordens_notas_acompanhamento assim que ordem_sap ou ordem_gerada aparecem na nota.';

DROP FUNCTION IF EXISTS public.resolve_admin_ordem_sem_nota(TEXT, TEXT);

DO $$
DECLARE
  v_ordens_detectadas INTEGER := 0;
  v_notas_auto_concluidas INTEGER := 0;
BEGIN
  SELECT
    COALESCE(t.ordens_detectadas, 0),
    COALESCE(t.notas_auto_concluidas, 0)
  INTO
    v_ordens_detectadas,
    v_notas_auto_concluidas
  FROM public.registrar_ordens_por_notas(NULL::UUID) t;

  RAISE NOTICE
    'Backfill 00193 - ordens materializadas: %, notas auto concluidas: %',
    v_ordens_detectadas,
    v_notas_auto_concluidas;
END;
$$;
