-- 00085_backfill_distribute_all_unassigned_orders.sql
--
-- Distribui TODAS as ordens sem administrador_id seguindo as regras de roteamento:
--   PMPL          → responsável configurado em responsaveis_tipo_ordem
--   Refrigeração  → admin especialidade='refrigeracao' com menor carga
--   CD TARUMA/TURISMO → Adriano (cd_taruma)
--   CD MANAUS     → Brenda  (cd_manaus)
--   GERAL/PMOS    → pick_fallback_admin_for_order (admin geral com menor carga)
--
-- Escopo:
--   Parte 1: ordens standalone (nota_id IS NULL)
--            → usa atribuir_responsavel_ordens_standalone() já existente
--   Parte 2: ordens vinculadas a notas concluídas (nota_id IS NOT NULL, administrador_id IS NULL)
--            → mesma lógica aplicada diretamente (notas já encerradas, sem distribuição automática)

DO $$
DECLARE
  v_result RECORD;
BEGIN
  -- ============================================================
  -- PARTE 1: Standalone → função existente cuida de tudo
  -- ============================================================
  SELECT * INTO v_result FROM public.atribuir_responsavel_ordens_standalone();

  RAISE NOTICE '00085 Parte 1 (standalone): total=% | preenchidos=% | pmpl=% | refrigeracao=% | cd_fixo=% | fallback=% | sem_destino=%',
    v_result.total_candidatas,
    v_result.responsaveis_preenchidos,
    v_result.atribuicoes_pmpl_config,
    v_result.atribuicoes_refrigeracao,
    v_result.atribuicoes_cd_fixo,
    v_result.atribuicoes_fallback,
    v_result.sem_destino;
END;
$$;

DO $$
DECLARE
  v_ordem         RECORD;
  v_destino       UUID;
  v_categoria     TEXT;
  v_esp_match     TEXT;
  v_pmpl_resp_id  UUID;
  v_pmpl_sub_id   UUID;

  v_total         INTEGER := 0;
  v_preenchidos   INTEGER := 0;
  v_pmpl_cnt      INTEGER := 0;
  v_refrig_cnt    INTEGER := 0;
  v_cd_cnt        INTEGER := 0;
  v_fallback_cnt  INTEGER := 0;
  v_sem_destino   INTEGER := 0;
BEGIN
  -- Responsável PMPL configurado
  SELECT r.responsavel_id, r.substituto_id INTO v_pmpl_resp_id, v_pmpl_sub_id
  FROM public.responsaveis_tipo_ordem r
  WHERE r.tipo_ordem = 'PMPL'
  LIMIT 1;

  -- ============================================================
  -- PARTE 2: Ordens vinculadas a notas sem administrador_id
  --          (nota_id IS NOT NULL, administrador_id IS NULL)
  --          Notas já concluídas não passam pelo distribuir_notas,
  --          então atribuímos direto na ordem.
  -- ============================================================
  FOR v_ordem IN
    SELECT
      o.id,
      o.ordem_codigo,
      o.centro,
      COALESCE(o.tipo_ordem, ref.tipo_ordem)          AS tipo_ordem_efetivo,
      ref.texto_breve,
      COALESCE(o.unidade, d.unidade)                  AS unidade_efetiva
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.ordens_manutencao_referencia ref
      ON ref.ordem_codigo_norm = o.ordem_codigo
    LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
    WHERE o.nota_id IS NOT NULL
      AND o.administrador_id IS NULL
      AND o.status_ordem NOT IN ('concluida', 'cancelada')
  LOOP
    v_total   := v_total + 1;
    v_destino := NULL;
    v_categoria := NULL;

    -- PASSO 1: PMPL
    IF v_ordem.tipo_ordem_efetivo = 'PMPL' THEN
      IF v_pmpl_resp_id IS NOT NULL THEN
        SELECT a.id INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_resp_id AND a.ativo = true AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias);
      END IF;
      IF v_destino IS NULL AND v_pmpl_sub_id IS NOT NULL THEN
        SELECT a.id INTO v_destino
        FROM public.administradores a
        WHERE a.id = v_pmpl_sub_id AND a.ativo = true AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias);
      END IF;
      IF v_destino IS NOT NULL THEN
        v_categoria := 'pmpl';
      ELSE
        v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
        v_categoria := 'fallback';
      END IF;
    END IF;

    -- PASSO 2: Refrigeração
    IF v_destino IS NULL THEN
      SELECT r.especialidade INTO v_esp_match
      FROM public.regras_distribuicao r
      WHERE r.especialidade = 'refrigeracao'
        AND COALESCE(v_ordem.texto_breve, '') ILIKE '%' || r.palavra_chave || '%'
      LIMIT 1;

      IF v_esp_match IS NOT NULL THEN
        SELECT a.id INTO v_destino
        FROM public.administradores a
        LEFT JOIN public.ordens_notas_acompanhamento oo
          ON oo.administrador_id = a.id AND oo.status_ordem NOT IN ('concluida','cancelada')
        WHERE a.especialidade = 'refrigeracao' AND a.ativo = true
          AND a.recebe_distribuicao = true AND a.em_ferias = false
          AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
               OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        GROUP BY a.id
        ORDER BY COUNT(oo.id) ASC, a.nome ASC
        LIMIT 1;

        IF v_destino IS NOT NULL THEN
          v_categoria := 'refrigeracao';
        ELSE
          -- Fallback gestor para refrigeração
          SELECT a.id INTO v_destino
          FROM public.administradores a
          WHERE a.role = 'gestor'
            AND LOWER(a.email) IN ('walterrodrigues@bemol.com.br','danieldamasceno@bemol.com.br')
            AND a.ativo = true AND a.em_ferias = false
            AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
                 OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
          ORDER BY a.nome ASC LIMIT 1;
          v_categoria := 'refrigeracao';
        END IF;
      END IF;
    END IF;

    -- PASSO 3: CD fixo por unidade
    IF v_destino IS NULL AND v_ordem.unidade_efetiva IS NOT NULL THEN
      SELECT a.id INTO v_destino
      FROM public.administradores a
      WHERE a.ativo = true AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
        AND (
          (a.especialidade = 'cd_taruma'
            AND (v_ordem.unidade_efetiva ILIKE '%TURISMO%' OR v_ordem.unidade_efetiva ILIKE '%TARUMA%'))
          OR
          (a.especialidade = 'cd_manaus' AND v_ordem.unidade_efetiva ILIKE '%MANAUS%')
        )
      ORDER BY a.nome ASC LIMIT 1;

      IF v_destino IS NOT NULL THEN v_categoria := 'cd_fixo'; END IF;
    END IF;

    -- PASSO 4: GERAL fallback
    IF v_destino IS NULL THEN
      v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
      v_categoria := 'fallback';
    END IF;

    -- Persistência
    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET administrador_id = v_destino, updated_at = now()
      WHERE id = v_ordem.id;

      v_preenchidos := v_preenchidos + 1;
      IF    v_categoria = 'pmpl'        THEN v_pmpl_cnt    := v_pmpl_cnt    + 1;
      ELSIF v_categoria = 'refrigeracao' THEN v_refrig_cnt  := v_refrig_cnt  + 1;
      ELSIF v_categoria = 'cd_fixo'     THEN v_cd_cnt      := v_cd_cnt      + 1;
      ELSE                                   v_fallback_cnt := v_fallback_cnt + 1;
      END IF;
    ELSE
      v_sem_destino := v_sem_destino + 1;
    END IF;

  END LOOP;

  RAISE NOTICE '00085 Parte 2 (notas concluídas): total=% | preenchidos=% | pmpl=% | refrigeracao=% | cd_fixo=% | fallback=% | sem_destino=%',
    v_total, v_preenchidos, v_pmpl_cnt, v_refrig_cnt, v_cd_cnt, v_fallback_cnt, v_sem_destino;
END;
$$;

-- ============================================================
-- Validação final
-- ============================================================
DO $$
DECLARE
  v_restante INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_restante
  FROM public.ordens_notas_acompanhamento
  WHERE administrador_id IS NULL
    AND tipo_ordem IS NOT NULL
    AND status_ordem NOT IN ('concluida','cancelada');

  RAISE NOTICE '00085 Ordens ainda sem responsável após distribuição: %', v_restante;
END;
$$;
