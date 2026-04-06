-- 00209_data_entrada_from_nota_data_criacao.sql
--
-- Problema:
-- Ordens vinculadas a notas (registradas via registrar_ordem_da_nota) ficam com
-- data_entrada NULL porque o helper nunca preenchia esse campo.
-- O cockpit cai no fallback COALESCE(data_entrada, ordem_detectada_em), onde
-- ordem_detectada_em = momento do sync (nao a data real de criacao no SAP).
-- Resultado: ordens aparecem com delay no cockpit.
--
-- Solucao:
-- Atualiza registrar_ordem_da_nota para setar data_entrada = data_criacao_sap
-- no INSERT e preencher o NULL no UPDATE (nunca sobrescreve valor existente).
-- Backfill de ordens existentes deve ser feito manualmente via SQL editor.

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
      data_entrada,
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
      v_nota.data_criacao_sap::TIMESTAMPTZ,
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
      data_entrada = COALESCE(
        ordens_notas_acompanhamento.data_entrada,
        v_nota.data_criacao_sap::TIMESTAMPTZ
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

COMMENT ON FUNCTION public.registrar_ordem_da_nota(UUID, UUID) IS
  'Materializa imediatamente a ordem vinculada a uma nota especifica em ordens_notas_acompanhamento. Popula data_entrada a partir de data_criacao_sap da nota (sem sobrescrever se ja existir).';
