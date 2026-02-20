-- 00020_split_notes_orders_panels.sql
-- Separacao em dois paineis (notas x ordens) + reatribuição em lote por checkbox

-- ============================================================
-- 1) VIEW CANONICA: NOTAS SEM ORDEM
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_sem_ordem AS
SELECT n.*
FROM public.notas_manutencao n
WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NULL;

-- ============================================================
-- 2) VIEW METRICAS DE NOTAS (30d) - USO GERENCIAL
-- ============================================================
CREATE OR REPLACE VIEW public.vw_notas_metrics_30d AS
WITH criadas AS (
  SELECT COUNT(*)::BIGINT AS qtd_notas_criadas_30d
  FROM public.notas_manutencao n
  WHERE COALESCE(n.data_criacao_sap, n.created_at::date)
    >= (current_date - INTERVAL '29 days')::date
),
viraram_ordem AS (
  SELECT
    COUNT(*)::BIGINT AS qtd_notas_viraram_ordem_30d,
    ROUND(AVG(o.dias_para_gerar_ordem)::NUMERIC, 2) AS tempo_medio_para_ordem_dias_30d
  FROM public.ordens_notas_acompanhamento o
  WHERE o.ordem_detectada_em >= now() - INTERVAL '30 days'
),
pendentes AS (
  SELECT COUNT(*)::BIGINT AS qtd_pendentes_sem_ordem
  FROM public.vw_notas_sem_ordem n
)
SELECT
  c.qtd_notas_criadas_30d,
  v.qtd_notas_viraram_ordem_30d,
  v.tempo_medio_para_ordem_dias_30d,
  p.qtd_pendentes_sem_ordem
FROM criadas c
CROSS JOIN viraram_ordem v
CROSS JOIN pendentes p;

-- ============================================================
-- 3) REGISTRO DE ORDEM: PRESERVAR RESPONSAVEL ORIGINAL
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
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

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
        v_nota.administrador_id,
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
-- 4) REATRIBUICAO DE ORDENS SELECIONADAS (CHECKBOX)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reatribuir_ordens_selecionadas(
  p_nota_ids UUID[],
  p_gestor_id UUID,
  p_modo TEXT,
  p_admin_destino UUID DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS TABLE(nota_id UUID, administrador_destino_id UUID) AS $$
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
    RAISE EXCEPTION 'Gestor inválido para reatribuição em lote de ordens';
  END IF;

  IF p_nota_ids IS NULL OR COALESCE(array_length(p_nota_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  IF p_modo NOT IN ('destino_unico', 'round_robin') THEN
    RAISE EXCEPTION 'Modo inválido. Use destino_unico ou round_robin';
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
      AND a.em_ferias = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destino unico inválido';
    END IF;
  ELSE
    SELECT array_agg(a.id ORDER BY a.nome) INTO v_destinos
    FROM public.administradores a
    WHERE a.role = 'admin'
      AND a.ativo = true
      AND a.em_ferias = false;

    v_destinos_count := COALESCE(array_length(v_destinos, 1), 0);

    IF v_destinos_count = 0 THEN
      RAISE EXCEPTION 'Não existem destinos elegíveis para round_robin';
    END IF;
  END IF;

  FOR v_nota IN
    SELECT DISTINCT nm.id, nm.administrador_id
    FROM public.notas_manutencao nm
    WHERE nm.id = ANY(p_nota_ids)
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NOT NULL
    ORDER BY nm.id
    FOR UPDATE
  LOOP
    IF p_modo = 'destino_unico' THEN
      v_destino := p_admin_destino;
    ELSE
      v_destino := v_destinos[v_rr_index];
      v_rr_index := (v_rr_index % v_destinos_count) + 1;
    END IF;

    IF v_nota.administrador_id IS NOT NULL AND v_nota.administrador_id = v_destino THEN
      CONTINUE;
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
      COALESCE(p_motivo, 'Reatribuição em lote de ordens pelo gestor (' || p_modo || ')')
    );

    IF v_nota.administrador_id IS NOT NULL THEN
      INSERT INTO public.nota_acompanhamentos (nota_id, administrador_id, origem)
      VALUES (v_nota.id, v_nota.administrador_id, 'reatribuicao_ordens_lote')
      ON CONFLICT (nota_id, administrador_id) DO NOTHING;
    END IF;

    nota_id := v_nota.id;
    administrador_destino_id := v_destino;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
