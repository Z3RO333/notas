-- 00195_fix_auto_note_registration_data_entrada_semantics.sql
--
-- Problema:
-- A 00194 passou a preencher data_entrada = now() em registrar_ordem_da_nota().
-- Isso quebrou a semantica canonica definida pela 00086:
--   - data_entrada = data real confirmada pela fonte PMOS/PMPL
--   - ordens bootstrap devem permanecer com data_entrada NULL ate o enriquecimento
--
-- Consequencia:
-- Ordens originadas de nota passaram a entrar imediatamente em vw_ordens_notas_painel
-- com competencia falsa, inflando recortes de PMOS e KPIs/graficos baseados em data_entrada.
--
-- Fix:
-- 1. registrar_ordem_da_nota() volta a NAO preencher data_entrada artificialmente
-- 2. backfill corretivo:
--    2.1 restaura data_entrada pela fonte real (ordens_financeiro_importado), quando houver
--    2.2 limpa data_entrada artificial remanescente nas ordens bootstrap detectadas na nota

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

DO $$
DECLARE
  v_restauradas INTEGER := 0;
  v_limpas INTEGER := 0;
BEGIN
  WITH candidatos AS MATERIALIZED (
    SELECT DISTINCT
      o.id,
      o.ordem_codigo
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NOT NULL
      AND o.data_entrada IS NOT NULL
      AND o.ordem_detectada_em IS NOT NULL
      AND o.data_entrada = o.ordem_detectada_em
      AND ABS(EXTRACT(EPOCH FROM (o.created_at - o.ordem_detectada_em))) < 86400
      AND EXISTS (
        SELECT 1
        FROM public.ordens_notas_historico h
        WHERE h.ordem_id = o.id
          AND h.origem = 'detectada_na_nota'
      )
  ),
  restauradas AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      data_entrada = CASE
        WHEN fi.tipo_ordem = 'PMPL' THEN fi.inicio_programado
        ELSE fi.data_entrada
      END,
      updated_at = now()
    FROM candidatos c
    JOIN public.ordens_financeiro_importado fi
      ON BTRIM(fi.ordem_codigo) = BTRIM(c.ordem_codigo)
    WHERE o.id = c.id
      AND (
        (fi.tipo_ordem = 'PMPL' AND fi.inicio_programado IS NOT NULL)
        OR (fi.tipo_ordem <> 'PMPL' AND fi.data_entrada IS NOT NULL)
      )
      AND o.data_entrada IS DISTINCT FROM CASE
        WHEN fi.tipo_ordem = 'PMPL' THEN fi.inicio_programado
        ELSE fi.data_entrada
      END
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_restauradas FROM restauradas;

  WITH candidatos AS MATERIALIZED (
    SELECT DISTINCT
      o.id,
      o.ordem_codigo
    FROM public.ordens_notas_acompanhamento o
    WHERE o.nota_id IS NOT NULL
      AND o.data_entrada IS NOT NULL
      AND o.ordem_detectada_em IS NOT NULL
      AND o.data_entrada = o.ordem_detectada_em
      AND ABS(EXTRACT(EPOCH FROM (o.created_at - o.ordem_detectada_em))) < 86400
      AND EXISTS (
        SELECT 1
        FROM public.ordens_notas_historico h
        WHERE h.ordem_id = o.id
          AND h.origem = 'detectada_na_nota'
      )
  ),
  limpas AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      data_entrada = NULL,
      updated_at = now()
    FROM candidatos c
    WHERE o.id = c.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.ordens_financeiro_importado fi
        WHERE BTRIM(fi.ordem_codigo) = BTRIM(c.ordem_codigo)
          AND (
            (fi.tipo_ordem = 'PMPL' AND fi.inicio_programado IS NOT NULL)
            OR (fi.tipo_ordem <> 'PMPL' AND fi.data_entrada IS NOT NULL)
          )
      )
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_limpas FROM limpas;

  RAISE NOTICE
    '00195 backfill: % ordens restauradas pela fonte real, % ordens bootstrap limpas',
    v_restauradas,
    v_limpas;
END;
$$;
