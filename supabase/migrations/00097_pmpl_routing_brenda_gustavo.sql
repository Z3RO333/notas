-- 00097_pmpl_routing_brenda_gustavo.sql
-- Corrige responsabilidade de ordens PMPL:
--   - CD MANAUS (centro 104) → sempre Brenda (especialidade cd_manaus), independente de quem gerou
--   - Demais centros → sempre Gustavo (especialidade elevadores / pmpl_config)
--   - Remove Adriano e Rosana do painel PMPL
--
-- Mudanças:
--   1. vw_ordens_notas_painel: PMPL ignora nota.administrador_id no responsavel_atual_id
--      (admin da nota é o analista PMOS, admin da ordem PMPL é quem executa a manutenção)
--   2. Backfill: todos PMPL abertos → centro 104 = Brenda, outros = Gustavo
--   3. atribuir_responsavel_ordens_standalone: PMPL não usa criado_por (PASSO 0 skip);
--      PASSO 2 adiciona sub-roteamento CD MANAUS → Brenda

-- ─── 1. Atualiza vw_ordens_notas_painel ───────────────────────────────────────
-- Para PMPL: responsavel_atual_id = COALESCE(o.administrador_id, o.criado_por)
-- Para PMOS: mantém COALESCE(n.administrador_id, o.administrador_id, o.criado_por)

CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT na.nota_id,
    count(*) AS qtd_historico,
    array_agg(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM nota_acompanhamentos na
  GROUP BY na.nota_id
), base AS (
  SELECT
    o.id            AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome     AS administrador_nome,
    -- PMPL: ignora nota.administrador_id (analista PMOS ≠ executor PMPL)
    -- PMOS: nota atual > ordem original > criador SAP
    CASE
      WHEN o.tipo_ordem = 'PMPL'
        THEN COALESCE(o.administrador_id, o.criado_por)
      ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
    END AS responsavel_atual_id,
    atual.nome      AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade)  AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    o.data_entrada  AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico,  0::bigint)       AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::uuid[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem,
    o.criado_por
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n       ON n.id       = o.nota_id
  LEFT JOIN public.administradores origem   ON origem.id  = o.administrador_id
  LEFT JOIN public.administradores atual    ON atual.id   = CASE
    WHEN o.tipo_ordem = 'PMPL'
      THEN COALESCE(o.administrador_id, o.criado_por)
    ELSE COALESCE(n.administrador_id, o.administrador_id, o.criado_por)
  END
  LEFT JOIN public.dim_centro_unidade d     ON d.centro   = o.centro
  LEFT JOIN historico h                     ON h.nota_id  = o.nota_id
  WHERE o.data_entrada IS NOT NULL
)
SELECT
  ordem_id,
  nota_id,
  numero_nota,
  ordem_codigo,
  administrador_id,
  administrador_nome,
  responsavel_atual_id,
  responsavel_atual_nome,
  centro,
  unidade,
  status_ordem,
  status_ordem_raw,
  ordem_detectada_em,
  status_atualizado_em,
  dias_para_gerar_ordem,
  qtd_historico,
  qtd_historico > 0 AS tem_historico,
  CASE
    WHEN status_ordem = ANY (ARRAY['concluida'::public.ordem_status_acomp, 'cancelada'::public.ordem_status_acomp]) THEN 0
    ELSE GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0)
  END AS dias_em_aberto,
  CASE
    WHEN status_ordem = ANY (ARRAY['concluida'::public.ordem_status_acomp, 'cancelada'::public.ordem_status_acomp]) THEN 'neutro'
    -- PMPL: manutenção planejada, ciclo longo — semáforo sempre verde
    WHEN tipo_ordem = 'PMPL' THEN 'verde'
    -- PMOS equipamento em conserto externo / aguardando fornecedor: threshold estendido
    WHEN status_ordem_raw IN ('EQUIPAMENTO_EM_CONSERTO', 'ENVIAR_EMAIL_PFORNECEDOR') THEN
      CASE
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 21 THEN 'vermelho'
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 10 THEN 'amarelo'
        ELSE 'verde'
      END
    -- PMOS outros: threshold original (7d vermelho, 3d amarelo)
    ELSE
      CASE
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 7 THEN 'vermelho'
        WHEN GREATEST(CURRENT_DATE - ordem_detectada_em::date, 0) >= 3 THEN 'amarelo'
        ELSE 'verde'
      END
  END AS semaforo_atraso,
  -- envolvidos: inclui criado_por no array
  ARRAY(
    SELECT DISTINCT x.x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id, b.criado_por]
    ) x(x)
    WHERE x.x IS NOT NULL
  ) AS envolvidos_admin_ids,
  descricao,
  tipo_ordem
FROM base b;

-- ─── 2. Backfill: PMPL abertos → Brenda (CD MANAUS) ou Gustavo (outros) ──────

DO $$
DECLARE
  v_gustavo UUID;
  v_brenda  UUID;
BEGIN
  SELECT id INTO v_gustavo FROM public.administradores WHERE especialidade = 'elevadores' LIMIT 1;
  SELECT id INTO v_brenda  FROM public.administradores WHERE especialidade = 'cd_manaus'  LIMIT 1;

  IF v_gustavo IS NULL THEN RAISE EXCEPTION 'Admin com especialidade elevadores não encontrado'; END IF;
  IF v_brenda  IS NULL THEN RAISE EXCEPTION 'Admin com especialidade cd_manaus não encontrado'; END IF;

  -- CD MANAUS (centro 104) → Brenda
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_brenda, updated_at = now()
  WHERE tipo_ordem = 'PMPL'
    AND centro = '104'
    AND status_ordem NOT IN ('concluida', 'cancelada')
    AND (administrador_id IS NULL OR administrador_id != v_brenda);

  -- Demais centros → Gustavo
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = v_gustavo, updated_at = now()
  WHERE tipo_ordem = 'PMPL'
    AND (centro IS NULL OR centro != '104')
    AND status_ordem NOT IN ('concluida', 'cancelada')
    AND (administrador_id IS NULL OR administrador_id != v_gustavo);

  RAISE NOTICE 'Backfill PMPL concluído: Brenda=centro104, Gustavo=outros';
END $$;

-- ─── 3. Atualiza atribuir_responsavel_ordens_standalone ───────────────────────
-- PASSO 0: criado_por não se aplica a PMPL (PMPL sempre roteado por tipo/centro)
-- PASSO 2: PMPL sub-rota CD MANAUS → cd_manaus specialist (Brenda)

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

    -- PASSO 0: criado_por (prioridade máxima para ordens PMOS standalone)
    -- PMPL não usa criado_por: roteado exclusivamente por tipo/centro no PASSO 2
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

    -- PASSO 2: PMPL — CD MANAUS (centro 104) → Brenda, outros → pmpl_config (Gustavo)
    IF v_destino IS NULL AND v_ordem.tipo_ordem_efetivo='PMPL' THEN
      -- Sub-roteamento CD MANAUS
      IF v_ordem.centro = '104' THEN
        SELECT a.id INTO v_destino FROM public.administradores a
        WHERE a.especialidade = 'cd_manaus' AND a.ativo = true AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        LIMIT 1;
        IF v_destino IS NOT NULL THEN v_categoria := 'cd_fixo'; END IF;
      END IF;
      -- Demais centros → pmpl_config
      IF v_destino IS NULL THEN
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
