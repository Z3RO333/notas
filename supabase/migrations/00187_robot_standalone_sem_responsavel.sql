-- 00187_robot_standalone_sem_responsavel.sql
--
-- Problema:
-- Ordens standalone (nota_id IS NULL) com criado_por_sap_codigo = 'ROBOT'
-- e sem regra forte de roteamento estavam caindo no fallback geral.
-- Na prática isso estava enchendo principalmente a carteira da Fabíola com
-- ordens ambíguas que não têm dono humano claro.
--
-- Solução:
-- 1. Atualiza atribuir_responsavel_ordens_standalone():
--    - PASSO 4A: se a ordem veio de ROBOT e não casou em criado_por /
--      refrigeração / PMPL / CD fixo, ela fica sem responsável
--      em vez de cair no fallback geral.
-- 2. Backfill:
--    - reseta ordens standalone ativas, com criado_por = NULL e
--      criado_por_sap_codigo = 'ROBOT', hoje atribuídas indevidamente
--      ao pool geral.

CREATE OR REPLACE FUNCTION public.atribuir_responsavel_ordens_standalone()
RETURNS TABLE(
  total_candidatas integer, responsaveis_preenchidos integer,
  atribuicoes_criado_por integer, atribuicoes_refrigeracao integer,
  atribuicoes_pmpl_config integer, atribuicoes_cd_fixo integer,
  atribuicoes_fallback integer, sem_destino integer,
  regras_refrigeracao_encontradas integer, admins_refrigeracao_elegiveis integer
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
        LEFT JOIN public.ordens_notas_acompanhamento oo ON oo.administrador_id=a.id AND oo.status_ordem NOT IN ('concluida','cancelada')
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

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.ordens_notas_acompanhamento o
  SET administrador_id = NULL, updated_at = now()
  WHERE o.nota_id IS NULL
    AND o.criado_por IS NULL
    AND COALESCE(o.criado_por_sap_codigo, '') = 'ROBOT'
    AND o.administrador_id IN (
      SELECT a.id
      FROM public.administradores a
      WHERE a.especialidade = 'geral'
        AND a.recebe_distribuicao = true
    )
    AND NOT public.status_raw_eh_final(o.status_ordem_raw);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfill ROBOT standalone: % ordens resetadas para sem responsável', v_count;
END $$;
