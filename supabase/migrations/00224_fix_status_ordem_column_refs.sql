-- 00224_fix_status_ordem_column_refs.sql
--
-- A coluna status_ordem foi dropada em 00168. Duas funções foram reescritas
-- depois dessa migration e reintroduziram a referência ao campo:
--
--   1. importar_ordens_pmpl_standalone (001001_operacionais_fornecedor.sql)
--      → coluna status_ordem no INSERT/UPDATE
--   2. atribuir_responsavel_ordens_standalone (00187_robot_standalone_sem_responsavel.sql)
--      → oo.status_ordem NOT IN ('concluida','cancelada') no JOIN
--
-- Esta migration restaura as versões corretas de ambas as funções.

-- ============================================================
-- 1. importar_ordens_pmpl_standalone
--    Fonte: 00168 (sem status_ordem, com criado_por_sap_codigo e texto_breve)
-- ============================================================
CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_item JSONB;
  v_ordem_codigo TEXT;
  v_status_raw TEXT;
  v_centro TEXT;
  v_unidade TEXT;
  v_denominacao_unidade TEXT;
  v_data_raw TEXT;
  v_data_entrada TIMESTAMPTZ;
  v_tipo_ordem TEXT;
  v_criado_por_sap TEXT;
  v_fornecedor_codigo TEXT;
  v_fornecedor_nome TEXT;
  v_texto_breve TEXT;
  v_exists BOOLEAN;
  v_total INTEGER := 0;
  v_inseridas INTEGER := 0;
  v_atualizadas INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw          := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_centro              := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_denominacao_unidade := NULLIF(BTRIM(v_item ->> 'denominacao_unidade'), '');
    v_tipo_ordem          := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');
    v_criado_por_sap      := NULLIF(BTRIM(v_item ->> 'criado_por_sap_codigo'), '');
    v_fornecedor_codigo   := NULLIF(BTRIM(v_item ->> 'fornecedor_codigo'), '');
    v_texto_breve         := NULLIF(BTRIM(v_item ->> 'texto_breve'), '');

    v_fornecedor_nome := NULL;
    IF v_fornecedor_codigo IS NOT NULL THEN
      SELECT d.nome
      INTO v_fornecedor_nome
      FROM public.dim_operacionais d
      WHERE d.codigo = v_fornecedor_codigo;
    END IF;

    v_data_raw := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION
        WHEN OTHERS THEN
          v_data_entrada := NULL;
      END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade
      INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.ordens_notas_acompanhamento
      WHERE ordem_codigo = v_ordem_codigo
    ) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      ordem_codigo,
      status_ordem_raw,
      centro,
      unidade,
      denominacao_unidade,
      data_entrada,
      tipo_ordem,
      criado_por_sap_codigo,
      fornecedor_codigo,
      fornecedor_nome,
      texto_breve,
      sync_id,
      ordem_detectada_em
    )
    VALUES (
      NULL,
      v_ordem_codigo,
      v_status_raw,
      v_centro,
      v_unidade,
      v_denominacao_unidade,
      v_data_entrada,
      v_tipo_ordem,
      v_criado_por_sap,
      v_fornecedor_codigo,
      v_fornecedor_nome,
      v_texto_breve,
      p_sync_id,
      COALESCE(v_data_entrada, now())
    )
    ON CONFLICT (ordem_codigo) DO UPDATE
    SET
      status_ordem_raw      = COALESCE(EXCLUDED.status_ordem_raw,      ordens_notas_acompanhamento.status_ordem_raw),
      centro                = COALESCE(EXCLUDED.centro,                ordens_notas_acompanhamento.centro),
      unidade               = COALESCE(EXCLUDED.unidade,               ordens_notas_acompanhamento.unidade),
      denominacao_unidade   = COALESCE(EXCLUDED.denominacao_unidade,   ordens_notas_acompanhamento.denominacao_unidade),
      data_entrada          = CASE
        WHEN EXCLUDED.data_entrada IS NULL THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem            = COALESCE(EXCLUDED.tipo_ordem,            ordens_notas_acompanhamento.tipo_ordem),
      criado_por_sap_codigo = COALESCE(EXCLUDED.criado_por_sap_codigo, ordens_notas_acompanhamento.criado_por_sap_codigo),
      fornecedor_codigo     = COALESCE(EXCLUDED.fornecedor_codigo,     ordens_notas_acompanhamento.fornecedor_codigo),
      fornecedor_nome       = COALESCE(EXCLUDED.fornecedor_nome,       ordens_notas_acompanhamento.fornecedor_nome),
      texto_breve           = COALESCE(EXCLUDED.texto_breve,           ordens_notas_acompanhamento.texto_breve),
      status_atualizado_em  = now(),
      sync_id               = COALESCE(EXCLUDED.sync_id,               ordens_notas_acompanhamento.sync_id),
      updated_at            = now();

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_inseridas, v_atualizadas;
END;
$function$;

-- ============================================================
-- 2. atribuir_responsavel_ordens_standalone
--    Fonte: 00187 com correção: status_ordem → status_raw_eh_ativo(status_ordem_raw)
-- ============================================================
CREATE OR REPLACE FUNCTION public.atribuir_responsavel_ordens_standalone()
RETURNS TABLE(
  total_candidatas INTEGER, responsaveis_preenchidos INTEGER,
  atribuicoes_criado_por INTEGER, atribuicoes_refrigeracao INTEGER,
  atribuicoes_pmpl_config INTEGER, atribuicoes_cd_fixo INTEGER,
  atribuicoes_fallback INTEGER, sem_destino INTEGER,
  regras_refrigeracao_encontradas INTEGER, admins_refrigeracao_elegiveis INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ordem RECORD; v_destino UUID; v_categoria TEXT; v_esp_match TEXT;
  v_pmpl_resp_id UUID; v_pmpl_sub_id UUID;
  v_total INTEGER:=0; v_preenchidos INTEGER:=0; v_criado_por_cnt INTEGER:=0;
  v_refrigeracao_cnt INTEGER:=0; v_pmpl_config_cnt INTEGER:=0;
  v_cd_fixo_cnt INTEGER:=0; v_fallback_cnt INTEGER:=0;
  v_sem_destino_cnt INTEGER:=0; v_regras_refrig INTEGER:=0; v_admins_refrig INTEGER:=0;
BEGIN
  SELECT COUNT(*) INTO v_regras_refrig FROM public.regras_distribuicao WHERE especialidade='refrigeracao';
  SELECT COUNT(*) INTO v_admins_refrig FROM public.administradores a
  WHERE a.especialidade='refrigeracao' AND a.ativo=true AND a.recebe_distribuicao=true AND a.em_ferias=false
    AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias);
  SELECT r.responsavel_id, r.substituto_id INTO v_pmpl_resp_id, v_pmpl_sub_id
  FROM public.responsaveis_tipo_ordem r WHERE r.tipo_ordem='PMPL' LIMIT 1;

  FOR v_ordem IN
    SELECT o.id, o.ordem_codigo, o.centro, o.criado_por, o.criado_por_sap_codigo,
      COALESCE(o.tipo_ordem, ref.tipo_ordem) AS tipo_ordem_efetivo,
      ref.texto_breve, COALESCE(o.unidade, d.unidade) AS unidade_efetiva
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref ON ref.ordem_codigo_norm = o.ordem_codigo
    LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
    WHERE o.nota_id IS NULL AND o.administrador_id IS NULL
  LOOP
    v_total:=v_total+1; v_destino:=NULL; v_categoria:=NULL;

    -- PASSO 0: criado_por (PMOS standalone apenas — PMPL roteado por pmpl_config no PASSO 2)
    IF v_ordem.criado_por IS NOT NULL AND v_ordem.tipo_ordem_efetivo IS DISTINCT FROM 'PMPL' THEN
      v_destino := v_ordem.criado_por;
      v_categoria := 'criado_por';
    END IF;

    -- PASSO 1: Refrigeração
    IF v_destino IS NULL THEN
      SELECT r.especialidade INTO v_esp_match FROM public.regras_distribuicao r
      WHERE r.especialidade='refrigeracao' AND COALESCE(v_ordem.texto_breve,'') ILIKE '%'||r.palavra_chave||'%' LIMIT 1;
      IF v_esp_match IS NOT NULL THEN
        SELECT a.id INTO v_destino FROM public.administradores a
        LEFT JOIN public.ordens_notas_acompanhamento oo
          ON oo.administrador_id=a.id AND public.status_raw_eh_ativo(oo.status_ordem_raw)
        WHERE a.especialidade='refrigeracao' AND a.ativo=true AND a.recebe_distribuicao=true AND a.em_ferias=false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        GROUP BY a.id ORDER BY COUNT(oo.id) ASC, a.nome ASC LIMIT 1;
        IF v_destino IS NOT NULL THEN v_categoria:='refrigeracao';
        ELSE
          SELECT a.id INTO v_destino FROM public.administradores a
          WHERE a.role='gestor' AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br','danieldamasceno@bemol.com.br')
            AND a.ativo=true AND a.em_ferias=false
            AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
          ORDER BY a.nome ASC LIMIT 1;
          IF v_destino IS NOT NULL THEN v_categoria:='refrigeracao';
          ELSE v_destino:=public.pick_fallback_admin_for_order(v_ordem.centro); v_categoria:='fallback'; END IF;
        END IF;
      END IF;
    END IF;

    -- PASSO 2: PMPL → pmpl_config
    IF v_destino IS NULL AND v_ordem.tipo_ordem_efetivo='PMPL' THEN
      IF v_pmpl_resp_id IS NOT NULL THEN
        SELECT a.id INTO v_destino FROM public.administradores a
        WHERE a.id=v_pmpl_resp_id AND a.ativo=true AND a.em_ferias=false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias);
      END IF;
      IF v_destino IS NULL AND v_pmpl_sub_id IS NOT NULL THEN
        SELECT a.id INTO v_destino FROM public.administradores a
        WHERE a.id=v_pmpl_sub_id AND a.ativo=true AND a.em_ferias=false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias);
      END IF;
      IF v_destino IS NOT NULL THEN v_categoria:='pmpl_config';
      ELSE v_destino:=public.pick_fallback_admin_for_order(v_ordem.centro); v_categoria:='fallback'; END IF;
    END IF;

    -- PASSO 3: CD fixo
    IF v_destino IS NULL AND v_ordem.unidade_efetiva IS NOT NULL THEN
      SELECT a.id INTO v_destino FROM public.administradores a
      WHERE a.ativo=true AND a.em_ferias=false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        AND ((a.especialidade='cd_taruma' AND (v_ordem.unidade_efetiva ILIKE '%TURISMO%' OR v_ordem.unidade_efetiva ILIKE '%TARUMA%'))
          OR (a.especialidade='cd_manaus' AND v_ordem.unidade_efetiva ILIKE '%MANAUS%'))
      ORDER BY a.nome ASC LIMIT 1;
      IF v_destino IS NOT NULL THEN v_categoria:='cd_fixo'; END IF;
    END IF;

    -- PASSO 4A: ROBOT sem regra forte -> sem responsável
    IF v_destino IS NULL AND COALESCE(v_ordem.criado_por_sap_codigo, '') = 'ROBOT' THEN
      v_sem_destino_cnt := v_sem_destino_cnt + 1;
      CONTINUE;
    END IF;

    -- PASSO 4B: Fila virtual por centro
    IF v_destino IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.centros_pool WHERE centro = v_ordem.centro) THEN
        v_sem_destino_cnt := v_sem_destino_cnt + 1;
        CONTINUE;
      END IF;
      v_destino:=public.pick_fallback_admin_for_order(v_ordem.centro); v_categoria:='fallback';
    END IF;

    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento SET administrador_id=v_destino, updated_at=now() WHERE id=v_ordem.id;
      v_preenchidos:=v_preenchidos+1;
      IF v_categoria='criado_por'      THEN v_criado_por_cnt:=v_criado_por_cnt+1;
      ELSIF v_categoria='refrigeracao' THEN v_refrigeracao_cnt:=v_refrigeracao_cnt+1;
      ELSIF v_categoria='pmpl_config'  THEN v_pmpl_config_cnt:=v_pmpl_config_cnt+1;
      ELSIF v_categoria='cd_fixo'      THEN v_cd_fixo_cnt:=v_cd_fixo_cnt+1;
      ELSE v_fallback_cnt:=v_fallback_cnt+1; END IF;
    ELSE
      v_sem_destino_cnt:=v_sem_destino_cnt+1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_total, v_preenchidos, v_criado_por_cnt,
    v_refrigeracao_cnt, v_pmpl_config_cnt, v_cd_fixo_cnt,
    v_fallback_cnt, v_sem_destino_cnt, v_regras_refrig, v_admins_refrig;
END;
$function$;
