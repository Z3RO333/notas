-- 00070_fix_adriano_centro_routing_and_backfill.sql
--
-- Regra de negócio confirmada:
--   - Adriano (cd_taruma) → ordens cujo centro mapeia para unidade CD TURISMO ou CD TARUMA
--                           (unidade_efetiva ILIKE '%TURISMO%' OR ILIKE '%TARUMA%')
--   - Brenda  (cd_manaus) → ordens cujo centro mapeia para unidade CD MANAUS
--   - GERAL/outros        → fallback menor carga (admins geral)
--
-- Problema atual: Adriano está recebendo ordens de CAMAPUA, MATRIZ, CD FARMA TARUMA
-- etc. porque o atribuir_responsavel_ordens_standalone não tem roteamento por centro.
-- Dados históricos (pré-migration 00060) estão atribuídos a ele incorretamente.
--
-- Mudanças:
--   1. atribuir_responsavel_ordens_standalone: adiciona PASSO 3 de roteamento
--      por unidade para CD owners (Adriano = CD TURISMO/TARUMA, Brenda = CD MANAUS)
--   2. Backfill: reatribuir notas abertas de Adriano cujo centro não é CD TURISMO/TARUMA
--   3. Backfill: reatribuir ordens standalone de Adriano cujo centro não é CD TURISMO/TARUMA

-- ============================================================
-- 1) atribuir_responsavel_ordens_standalone (atualização)
--    Adiciona PASSO 3: roteamento por unidade para CD owners
--    Requer DROP pois o tipo de retorno muda (+ atribuicoes_cd_fixo)
-- ============================================================
DROP FUNCTION IF EXISTS public.atribuir_responsavel_ordens_standalone();

CREATE OR REPLACE FUNCTION public.atribuir_responsavel_ordens_standalone()
RETURNS TABLE(
  total_candidatas                INTEGER,
  responsaveis_preenchidos        INTEGER,
  atribuicoes_refrigeracao        INTEGER,
  atribuicoes_pmpl_config         INTEGER,
  atribuicoes_cd_fixo             INTEGER,
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
  v_cd_fixo_cnt      INTEGER := 0;
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
  -- JOIN dim_centro_unidade para ter unidade_efetiva disponível no loop
  FOR v_ordem IN
    SELECT
      o.id,
      o.ordem_codigo,
      o.centro,
      COALESCE(o.tipo_ordem, ref.tipo_ordem) AS tipo_ordem_efetivo,
      ref.texto_breve,
      COALESCE(o.unidade, d.unidade) AS unidade_efetiva
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
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
    -- PASSO 3: Roteamento por unidade para CD owners
    --   CD TURISMO ou CD TARUMA → Adriano (cd_taruma)
    --   CD MANAUS               → Brenda  (cd_manaus)
    --   Só tenta se admin de CD está ativo e disponível.
    --   Se indisponível, cai para PASSO 4 (fallback GERAL).
    -- --------------------------------------------------------
    IF v_destino IS NULL AND v_ordem.unidade_efetiva IS NOT NULL THEN
      SELECT a.id INTO v_destino
      FROM public.administradores a
      WHERE a.ativo = true
        AND a.em_ferias = false
        AND (
          a.data_inicio_ferias IS NULL
          OR a.data_fim_ferias IS NULL
          OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
        )
        AND (
          (a.especialidade = 'cd_taruma'
            AND (v_ordem.unidade_efetiva ILIKE '%TURISMO%' OR v_ordem.unidade_efetiva ILIKE '%TARUMA%'))
          OR
          (a.especialidade = 'cd_manaus' AND v_ordem.unidade_efetiva ILIKE '%MANAUS%')
        )
      ORDER BY a.nome ASC
      LIMIT 1;

      IF v_destino IS NOT NULL THEN
        v_categoria := 'cd_fixo';
      END IF;
    END IF;

    -- --------------------------------------------------------
    -- PASSO 4: PMOS / GERAL → SEMPRE admin GERAL (nunca gestor)
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
      ELSIF v_categoria = 'cd_fixo' THEN
        v_cd_fixo_cnt := v_cd_fixo_cnt + 1;
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
    v_cd_fixo_cnt,
    v_fallback_cnt,
    v_sem_destino_cnt,
    v_regras_refrig,
    v_admins_refrig;
END;
$$;

COMMENT ON FUNCTION public.atribuir_responsavel_ordens_standalone() IS
  'Atribui administrador_id para ordens standalone (nota_id IS NULL, administrador_id IS NULL). '
  'Precedência: refrigeração (admin) → refrigeração (gestor: Walter/Daniel) → GERAL admin | '
  'PMPL config → GERAL admin | CD TURISMO/TARUMA → Adriano | CD MANAUS → Brenda | GERAL/PMOS → GERAL admin.';

-- ============================================================
-- 2) BACKFILL: notas de Adriano cujo centro NÃO é CD TURISMO/TARUMA
--    → reatribui para admin GERAL de menor carga
-- ============================================================
DO $$
DECLARE
  v_id         UUID;
  v_centro     TEXT;
  v_old_admin  UUID;
  v_new_admin  UUID;
  v_count_a    INTEGER := 0;
  v_count_b    INTEGER := 0;
BEGIN

  -- a) Notas abertas de Adriano fora do CD TURISMO/TARUMA
  FOR v_id, v_centro, v_old_admin IN
    SELECT n.id, n.centro, n.administrador_id
    FROM public.notas_manutencao n
    JOIN public.administradores a ON a.id = n.administrador_id
    WHERE LOWER(a.email) = 'adrianobezerra@bemol.com.br'
      AND n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      AND NOT EXISTS (
        SELECT 1 FROM public.dim_centro_unidade dcu
        WHERE dcu.centro = n.centro
          AND (dcu.unidade ILIKE '%TURISMO%' OR dcu.unidade ILIKE '%TARUMA%')
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
        'Backfill 00070: reatribuição de nota fora do CD TURISMO/TARUMA de Adriano para admin GERAL'
      );

      UPDATE public.notas_manutencao
      SET administrador_id = v_new_admin, updated_at = now()
      WHERE id = v_id;

      v_count_a := v_count_a + 1;
    END IF;
  END LOOP;

  -- b) Ordens standalone de Adriano fora do CD TURISMO/TARUMA
  FOR v_id, v_centro IN
    SELECT o.id, o.centro
    FROM public.ordens_notas_acompanhamento o
    JOIN public.administradores a ON a.id = o.administrador_id
    WHERE LOWER(a.email) = 'adrianobezerra@bemol.com.br'
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
      AND o.nota_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.dim_centro_unidade dcu
        WHERE dcu.centro = o.centro
          AND (dcu.unidade ILIKE '%TURISMO%' OR dcu.unidade ILIKE '%TARUMA%')
      )
  LOOP
    v_new_admin := public.pick_fallback_admin_for_order(v_centro);
    IF v_new_admin IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET administrador_id = v_new_admin, updated_at = now()
      WHERE id = v_id;

      v_count_b := v_count_b + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill 00070 concluído: notas_reatribuidas=% ordens_standalone_reatribuidas=%',
    v_count_a, v_count_b;
END;
$$;
