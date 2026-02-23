-- 00067_fix_refrigeracao_fallback_gestor_and_reassign_geral.sql
--
-- Regras de negócio confirmadas:
--   - Refrigeração sem admin disponível → gestor fallback (Daniel/Walter)
--     e só então GERAL admin como último recurso
--   - GERAL/PMOS → SEMPRE para admin GERAL (role=admin, especialidade=geral), nunca gestor
--
-- Mudanças:
--   1. atribuir_responsavel_ordens_standalone: adiciona etapa gestor entre
--      "sem admin refrig" e "fallback GERAL"
--   2. Backfill: ordens abertas de gestores que NÃO são refrigeração →
--      reatribui para pick_fallback_admin_for_order (admin GERAL)
--      Escopo: ordens standalone (ordens_notas_acompanhamento.administrador_id)
--              + notas com ordens vinculadas (notas_manutencao.administrador_id)

-- ============================================================
-- 1) atribuir_responsavel_ordens_standalone (atualização cirúrgica)
--    Única mudança: ELSE do bloco refrigeração — tenta gestor antes do fallback GERAL
-- ============================================================
CREATE OR REPLACE FUNCTION public.atribuir_responsavel_ordens_standalone()
RETURNS TABLE(
  total_candidatas                INTEGER,
  responsaveis_preenchidos        INTEGER,
  atribuicoes_refrigeracao        INTEGER,
  atribuicoes_pmpl_config         INTEGER,
  atribuicoes_fallback            INTEGER,
  sem_destino                     INTEGER,
  regras_refrigeracao_encontradas INTEGER,
  admins_refrigeracao_elegiveis   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ordem            RECORD;
  v_destino          UUID;
  v_categoria        TEXT;
  v_esp_match        TEXT;
  v_pmpl_resp_id     UUID;
  v_pmpl_sub_id      UUID;

  v_total            INTEGER := 0;
  v_preenchidos      INTEGER := 0;
  v_refrigeracao_cnt INTEGER := 0;
  v_pmpl_config_cnt  INTEGER := 0;
  v_fallback_cnt     INTEGER := 0;
  v_sem_destino_cnt  INTEGER := 0;
  v_regras_refrig    INTEGER := 0;
  v_admins_refrig    INTEGER := 0;
BEGIN
  -- Métricas de diagnóstico (calculadas antes do loop)
  SELECT COUNT(*) INTO v_regras_refrig
  FROM public.regras_distribuicao
  WHERE especialidade = 'refrigeracao';

  SELECT COUNT(*) INTO v_admins_refrig
  FROM public.administradores a
  WHERE a.especialidade = 'refrigeracao'
    AND a.ativo = true
    AND a.recebe_distribuicao = true
    AND a.em_ferias = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    );

  -- Responsável PMPL configurado (lido uma vez fora do loop)
  SELECT r.responsavel_id, r.substituto_id INTO v_pmpl_resp_id, v_pmpl_sub_id
  FROM public.responsaveis_tipo_ordem r
  WHERE r.tipo_ordem = 'PMPL'
  LIMIT 1;

  -- Loop sobre candidatas: standalone sem responsável
  FOR v_ordem IN
    SELECT
      o.id,
      o.ordem_codigo,
      o.centro,
      COALESCE(o.tipo_ordem, ref.tipo_ordem) AS tipo_ordem_efetivo,
      ref.texto_breve
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    WHERE o.nota_id IS NULL
      AND o.administrador_id IS NULL
  LOOP
    v_total     := v_total + 1;
    v_destino   := NULL;
    v_categoria := NULL;

    -- --------------------------------------------------------
    -- PASSO 1: Detecção de refrigeração
    -- --------------------------------------------------------
    SELECT r.especialidade INTO v_esp_match
    FROM public.regras_distribuicao r
    WHERE r.especialidade = 'refrigeracao'
      AND COALESCE(v_ordem.texto_breve, '') ILIKE '%' || r.palavra_chave || '%'
    LIMIT 1;

    IF v_esp_match IS NOT NULL THEN
      -- Admin de refrigeração com menor carga
      SELECT a.id INTO v_destino
      FROM public.administradores a
      LEFT JOIN public.ordens_notas_acompanhamento oo
        ON oo.administrador_id = a.id
        AND oo.status_ordem NOT IN ('concluida', 'cancelada')
      WHERE a.especialidade = 'refrigeracao'
        AND a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND (
          a.data_inicio_ferias IS NULL
          OR a.data_fim_ferias IS NULL
          OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
        )
      GROUP BY a.id
      ORDER BY COUNT(oo.id) ASC, a.nome ASC
      LIMIT 1;

      IF v_destino IS NOT NULL THEN
        v_categoria := 'refrigeracao';
      ELSE
        -- Sem admin refrigeração elegível:
        -- tenta gestor fallback (Walter/Daniel) antes do fallback GERAL
        SELECT a.id INTO v_destino
        FROM public.administradores a
        WHERE a.role = 'gestor'
          AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br', 'danieldamasceno@bemol.com.br')
          AND a.ativo = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          )
        ORDER BY a.nome ASC
        LIMIT 1;

        IF v_destino IS NOT NULL THEN
          v_categoria := 'refrigeracao';  -- conta como refrigeração (gestão direta)
        ELSE
          -- Último recurso: admin GERAL
          v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
          v_categoria := 'fallback';
        END IF;
      END IF;
    END IF;

    -- --------------------------------------------------------
    -- PASSO 2: PMPL (apenas se não foi detectado refrigeração)
    -- --------------------------------------------------------
    IF v_destino IS NULL AND v_ordem.tipo_ordem_efetivo = 'PMPL' THEN
      -- Tenta responsável principal configurado
      IF v_pmpl_resp_id IS NOT NULL THEN
        SELECT a.id INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_resp_id
          AND a.ativo = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          );
      END IF;

      -- Tenta substituto se principal indisponível
      IF v_destino IS NULL AND v_pmpl_sub_id IS NOT NULL THEN
        SELECT a.id INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_sub_id
          AND a.ativo = true
          AND a.em_ferias = false
          AND (
            a.data_inicio_ferias IS NULL
            OR a.data_fim_ferias IS NULL
            OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
          );
      END IF;

      IF v_destino IS NOT NULL THEN
        v_categoria := 'pmpl_config';
      ELSE
        v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
        v_categoria := 'fallback';
      END IF;
    END IF;

    -- --------------------------------------------------------
    -- PASSO 3: PMOS / GERAL → SEMPRE admin GERAL (nunca gestor)
    -- --------------------------------------------------------
    IF v_destino IS NULL THEN
      v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
      v_categoria := 'fallback';
    END IF;

    -- Persistência
    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET
        administrador_id = v_destino,
        updated_at       = now()
      WHERE id = v_ordem.id;

      v_preenchidos := v_preenchidos + 1;

      IF v_categoria = 'refrigeracao' THEN
        v_refrigeracao_cnt := v_refrigeracao_cnt + 1;
      ELSIF v_categoria = 'pmpl_config' THEN
        v_pmpl_config_cnt := v_pmpl_config_cnt + 1;
      ELSE
        v_fallback_cnt := v_fallback_cnt + 1;
      END IF;
    ELSE
      v_sem_destino_cnt := v_sem_destino_cnt + 1;
    END IF;

  END LOOP;

  RETURN QUERY SELECT
    v_total,
    v_preenchidos,
    v_refrigeracao_cnt,
    v_pmpl_config_cnt,
    v_fallback_cnt,
    v_sem_destino_cnt,
    v_regras_refrig,
    v_admins_refrig;
END;
$$;

COMMENT ON FUNCTION public.atribuir_responsavel_ordens_standalone() IS
  'Atribui administrador_id para ordens standalone (nota_id IS NULL, administrador_id IS NULL). '
  'Precedência: refrigeração (admin) → refrigeração (gestor fallback: Walter/Daniel) → GERAL admin | PMPL config → GERAL admin | GERAL/PMOS → GERAL admin (nunca gestor).';

-- ============================================================
-- 2) BACKFILL: ordens abertas de gestores NÃO refrigeração → admin GERAL
--    a) Standalone (ordens_notas_acompanhamento.administrador_id = gestor)
--    b) Via nota (notas_manutencao.administrador_id = gestor + nota aberta)
-- ============================================================
DO $$
DECLARE
  v_id        UUID;
  v_centro    TEXT;
  v_old_admin UUID;
  v_new_admin UUID;
  v_count_a   INTEGER := 0;
  v_count_b   INTEGER := 0;
BEGIN

  -- a) Ordens standalone com administrador_id = gestor não-refrigeração
  FOR v_id, v_centro IN
    SELECT o.id, o.centro
    FROM public.ordens_notas_acompanhamento o
    JOIN public.administradores a ON a.id = o.administrador_id
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    WHERE a.role = 'gestor'
      AND LOWER(a.email) IN ('danieldamasceno@bemol.com.br', 'walterrodrigues@bemol.com.br')
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
      AND o.nota_id IS NULL
      -- Exclui ordens de refrigeração (mantém com gestor)
      AND NOT EXISTS (
        SELECT 1 FROM public.regras_distribuicao r
        WHERE r.especialidade = 'refrigeracao'
          AND COALESCE(ref.texto_breve, '') ILIKE '%' || r.palavra_chave || '%'
      )
  LOOP
    v_new_admin := public.pick_fallback_admin_for_order(v_centro);
    IF v_new_admin IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET administrador_id = v_new_admin, updated_at = now()
      WHERE id = v_id;
      v_count_a := v_count_a + 1;
    END IF;
  END LOOP;

  -- b) Notas abertas com administrador_id = gestor e texto não refrigeração
  --    (as ordens vinculadas herdam via COALESCE na view)
  FOR v_id, v_centro, v_old_admin IN
    SELECT n.id, n.centro, n.administrador_id
    FROM public.notas_manutencao n
    JOIN public.administradores a ON a.id = n.administrador_id
    WHERE a.role = 'gestor'
      AND LOWER(a.email) IN ('danieldamasceno@bemol.com.br', 'walterrodrigues@bemol.com.br')
      AND n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      -- Exclui notas de refrigeração (mantém com gestor)
      AND NOT EXISTS (
        SELECT 1 FROM public.regras_distribuicao r
        WHERE r.especialidade = 'refrigeracao'
          AND COALESCE(n.descricao, '') ILIKE '%' || r.palavra_chave || '%'
      )
  LOOP
    v_new_admin := public.pick_fallback_admin_for_order(v_centro);
    IF v_new_admin IS NOT NULL THEN
      INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
      VALUES (
        v_id,
        'administrador_id',
        v_old_admin::TEXT,
        v_new_admin::TEXT,
        'Backfill 00067: reatribuição de nota GERAL de gestor para admin GERAL'
      );

      UPDATE public.notas_manutencao
      SET administrador_id = v_new_admin, updated_at = now()
      WHERE id = v_id;

      v_count_b := v_count_b + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill 00067 concluído: standalone=% notas=%', v_count_a, v_count_b;
END;
$$;
