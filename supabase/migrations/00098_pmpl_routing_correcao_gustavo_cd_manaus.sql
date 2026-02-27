-- 00098_pmpl_routing_correcao_gustavo_cd_manaus.sql
-- Reverte: Gustavo cuida de PMPL de TODAS as unidades (inclusive CD MANAUS).
-- Só as ordens que estavam com Rosana (CD MANAUS) vão para Brenda.
-- Adriano já foi movido para Gustavo pela 00097 (correto).
-- Nota: as 4 ordens da Rosana (5133803,5116067,5133802,5108305) têm data_entrada=NULL
-- e não aparecem no painel — atribuídas a Brenda para quando/se receberem data_entrada.

DO $$
DECLARE
  v_gustavo UUID;
  v_brenda  UUID;
BEGIN
  SELECT id INTO v_gustavo FROM public.administradores WHERE especialidade = 'elevadores' LIMIT 1;
  SELECT id INTO v_brenda  FROM public.administradores WHERE especialidade = 'cd_manaus'  LIMIT 1;

  -- 1. Reverte: todas PMPL CD MANAUS → Gustavo
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_gustavo, updated_at = now()
  WHERE tipo_ordem = 'PMPL'
    AND centro = '104'
    AND status_ordem NOT IN ('concluida', 'cancelada')
    AND (administrador_id IS NULL OR administrador_id != v_gustavo);

  -- 2. As 4 ordens que eram da Rosana (CD MANAUS) → Brenda
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_brenda, updated_at = now()
  WHERE ordem_codigo IN ('5133803', '5116067', '5133802', '5108305')
    AND tipo_ordem = 'PMPL'
    AND status_ordem NOT IN ('concluida', 'cancelada');

  RAISE NOTICE 'Corrigido: Gustavo mantém CD MANAUS PMPL, Brenda recebe apenas as 4 ordens da Rosana';
END $$;

-- Atualiza atribuir_responsavel_ordens_standalone:
-- Remove sub-roteamento CD MANAUS para PMPL (Gustavo cuida de todas as unidades PMPL)
-- Mantém: PMPL não usa criado_por (PASSO 0 skip)

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
    SELECT o.id, o.ordem_codigo, o.centro, o.criado_por,
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

    -- PASSO 2: PMPL → pmpl_config (Gustavo, todas as unidades)
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

    -- PASSO 3: CD fixo (PMOS com unidade específica)
    IF v_destino IS NULL AND v_ordem.unidade_efetiva IS NOT NULL THEN
      SELECT a.id INTO v_destino FROM public.administradores a
      WHERE a.ativo=true AND a.em_ferias=false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        AND ((a.especialidade='cd_taruma' AND (v_ordem.unidade_efetiva ILIKE '%TURISMO%' OR v_ordem.unidade_efetiva ILIKE '%TARUMA%'))
          OR (a.especialidade='cd_manaus' AND v_ordem.unidade_efetiva ILIKE '%MANAUS%'))
      ORDER BY a.nome ASC LIMIT 1;
      IF v_destino IS NOT NULL THEN v_categoria:='cd_fixo'; END IF;
    END IF;

    -- PASSO 4: Fallback geral
    IF v_destino IS NULL THEN
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
    ELSE v_sem_destino_cnt:=v_sem_destino_cnt+1; END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_total, v_preenchidos, v_criado_por_cnt,
    v_refrigeracao_cnt, v_pmpl_config_cnt, v_cd_fixo_cnt,
    v_fallback_cnt, v_sem_destino_cnt, v_regras_refrig, v_admins_refrig;
END;
$function$;
