-- 00186_centros_pool_fila_virtual.sql
--
-- Cria fila virtual para ordens de centros sem responsável mapeado.
--
-- Problema: ordens standalone (nota_id IS NULL) de cidades sem admin local
-- (Porto Velho, Rio Branco, Boa Vista) caíam no fallback geral e
-- apareciam no card de Fabíola/Paula sem nenhuma relação real com elas.
--
-- Solução:
--   1. Tabela centros_pool: mapeia centros → fila virtual (pool_nome + pool_label)
--   2. atribuir_responsavel_ordens_standalone: PASSO 4 pula pool centers (deixa NULL)
--   3. Backfill: reseta standalone de pool centers atribuídos indevidamente ao geral
--   4. RPC calcular_resumo_pool_centros: resumo por fila para os cards do painel

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela centros_pool
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.centros_pool (
  centro      TEXT PRIMARY KEY,
  pool_nome   TEXT NOT NULL,   -- slug identificador: 'porto_velho', 'boa_vista', 'rio_branco'
  pool_label  TEXT NOT NULL,   -- texto de exibição: 'Porto Velho', 'Boa Vista', 'Rio Branco'
  created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.centros_pool IS
  'Centros sem responsável fixo mapeado — ordens standalone destes centros '
  'ficam em fila virtual em vez de cair no geral.';

INSERT INTO public.centros_pool (centro, pool_nome, pool_label) VALUES
  -- Porto Velho (RO)
  ('201', 'porto_velho', 'Porto Velho'),
  ('202', 'porto_velho', 'Porto Velho'),
  ('203', 'porto_velho', 'Porto Velho'),
  ('204', 'porto_velho', 'Porto Velho'),
  ('205', 'porto_velho', 'Porto Velho'),
  ('206', 'porto_velho', 'Porto Velho'),
  -- Rio Branco (AC)
  ('401', 'rio_branco', 'Rio Branco'),
  ('402', 'rio_branco', 'Rio Branco'),
  -- Boa Vista (RR)
  ('701', 'boa_vista', 'Boa Vista'),
  ('702', 'boa_vista', 'Boa Vista'),
  ('703', 'boa_vista', 'Boa Vista'),
  ('704', 'boa_vista', 'Boa Vista'),
  ('705', 'boa_vista', 'Boa Vista'),
  ('706', 'boa_vista', 'Boa Vista')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atualiza atribuir_responsavel_ordens_standalone
--    PASSO 4 (fallback): pula ordens de centros_pool, deixa administrador_id = NULL
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- Centros em centros_pool ficam como fila virtual (administrador_id = NULL)
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
    ELSE v_sem_destino_cnt:=v_sem_destino_cnt+1; END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_total, v_preenchidos, v_criado_por_cnt,
    v_refrigeracao_cnt, v_pmpl_config_cnt, v_cd_fixo_cnt,
    v_fallback_cnt, v_sem_destino_cnt, v_regras_refrig, v_admins_refrig;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill: reseta standalone de pool centers atribuídos indevidamente ao geral
--    Somente: nota_id IS NULL + especialidade geral + status ativo
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.ordens_notas_acompanhamento o
  SET administrador_id = NULL, updated_at = now()
  WHERE o.nota_id IS NULL
    AND EXISTS (SELECT 1 FROM public.centros_pool cp WHERE cp.centro = o.centro)
    AND o.administrador_id IN (
      SELECT a.id FROM public.administradores a
      WHERE a.especialidade = 'geral' AND a.recebe_distribuicao = true
    )
    AND NOT public.status_raw_eh_final(o.status_ordem_raw);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfill pool: % ordens resetadas para fila virtual', v_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC calcular_resumo_pool_centros
--    Retorna resumo por fila virtual para os cards do painel de ordens.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_resumo_pool_centros(
  p_period_mode        TEXT DEFAULT 'all',
  p_year               INTEGER DEFAULT NULL,
  p_month              INTEGER DEFAULT NULL,
  p_start_iso          TIMESTAMPTZ DEFAULT NULL,
  p_end_exclusive_iso  TIMESTAMPTZ DEFAULT NULL,
  p_tipo_ordem         TEXT DEFAULT NULL
)
RETURNS TABLE(
  pool_nome   TEXT,
  pool_label  TEXT,
  total       BIGINT,
  atrasadas   BIGINT,
  atencao     BIGINT,
  abertas     BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    cp.pool_nome,
    cp.pool_label,
    COUNT(*)::BIGINT                                                     AS total,
    COUNT(*) FILTER (WHERE v.semaforo_atraso = 'vermelho')::BIGINT      AS atrasadas,
    COUNT(*) FILTER (WHERE v.semaforo_atraso = 'amarelo')::BIGINT       AS atencao,
    COUNT(*) FILTER (WHERE v.status_ordem::TEXT = 'aberta')::BIGINT     AS abertas
  FROM public.filtrar_ordens_workspace(
    p_period_mode       => p_period_mode,
    p_year              => p_year,
    p_month             => p_month,
    p_start_iso         => p_start_iso,
    p_end_exclusive_iso => p_end_exclusive_iso,
    p_status            => 'ativas',
    p_tipo_ordem        => p_tipo_ordem
  ) v
  JOIN public.centros_pool cp ON cp.centro = v.centro
  WHERE v.responsavel_atual_id IS NULL
  GROUP BY cp.pool_nome, cp.pool_label
  ORDER BY total DESC;
$$;
