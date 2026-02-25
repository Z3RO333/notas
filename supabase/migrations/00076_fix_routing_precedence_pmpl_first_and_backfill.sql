-- 00076_fix_routing_precedence_pmpl_first_and_backfill.sql
--
-- Problema confirmado:
--   atribuir_responsavel_ordens_standalone() (migration 00070) tem precedência errada:
--     Atual:    Refrigeração → PMPL → CD fixo → Fallback
--     Correto:  PMPL → Refrigeração → CD fixo → Fallback
--
-- O TypeScript (pmpl-routing.ts) já está correto com PMPL primeiro.
-- Esta migration alinha a função SQL com a regra de negócio e o TypeScript.
--
-- Mudanças:
--   1. Recriar atribuir_responsavel_ordens_standalone() com PMPL como PASSO 1
--   2. Backfill: resetar e reatribuir ordens standalone abertas
--   3. Resumo quantitativo via RAISE NOTICE
--
-- Regras de precedência aplicadas (documentadas explicitamente):
--   PASSO 1: PMPL  (tipo_ordem_efetivo = 'PMPL')
--            → responsável configurado em responsaveis_tipo_ordem
--            → substituto se principal indisponível
--            → fallback GERAL se ambos indisponíveis
--   PASSO 2: Refrigeração  (keyword match em texto_breve via regras_distribuicao)
--            → admin de especialidade 'refrigeracao' com menor carga
--            → fallback: gestor Walter/Daniel
--            → fallback: admin GERAL
--   PASSO 3: CD fixo  (unidade_efetiva)
--            → CD TURISMO ou CD TARUMA → especialidade cd_taruma (Adriano)
--            → CD MANAUS → especialidade cd_manaus (Brenda)
--   PASSO 4: GERAL  (pick_fallback_admin_for_order)
--
-- Tradeoff de precedência documentado:
--   PMPL antes de Refrigeração garante que uma ordem PMPL que coincida com
--   keywords de refrigeração seja sempre gerenciada pelo responsável PMPL.
--   Na prática improvável, mas a regra de negócio exige PMPL como prioridade máxima.

-- ============================================================
-- 1) Recriar função com PMPL em PASSO 1
--    DROP necessário pois o COMMENT referencia a assinatura anterior
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
    -- PASSO 1: PMPL
    --   Tem precedência máxima. Uma ordem PMPL vai sempre para
    --   o responsável PMPL configurado, independente de qualquer
    --   outro critério (inclusive keywords de refrigeração).
    -- --------------------------------------------------------
    IF v_ordem.tipo_ordem_efetivo = 'PMPL' THEN
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
    -- PASSO 2: Refrigeração (apenas se não foi PMPL)
    -- --------------------------------------------------------
    IF v_destino IS NULL THEN
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
  'Precedência (00076): PMPL config → Refrigeração (admin) → Refrigeração (gestor: Walter/Daniel) → '
  'CD TURISMO/TARUMA → Adriano | CD MANAUS → Brenda | GERAL/PMOS → GERAL admin. '
  'PMPL tem prioridade máxima: uma ordem PMPL nunca é roteada para refrigeração mesmo com keywords.';

-- ============================================================
-- 2) Backfill: resetar e reatribuir ordens standalone abertas
--    com a nova lógica de precedência
-- ============================================================
DO $$
DECLARE
  v_result          RECORD;
  v_before          INTEGER;
  v_sem_admin_antes INTEGER;
BEGIN
  -- Contagem antes do reset para relatório
  SELECT COUNT(*) INTO v_before
  FROM public.ordens_notas_acompanhamento
  WHERE nota_id IS NULL
    AND status_ordem NOT IN ('concluida', 'cancelada');

  SELECT COUNT(*) INTO v_sem_admin_antes
  FROM public.ordens_notas_acompanhamento
  WHERE nota_id IS NULL
    AND administrador_id IS NULL
    AND status_ordem NOT IN ('concluida', 'cancelada');

  RAISE NOTICE '00076 Backfill início: total_standalone_abertas=% | sem_admin_antes=%',
    v_before, v_sem_admin_antes;

  -- Reset: zero administrador para todas as standalone abertas
  -- (serão reatribuídas pela função logo abaixo)
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = NULL,
      updated_at       = now()
  WHERE nota_id IS NULL
    AND status_ordem NOT IN ('concluida', 'cancelada');

  -- Re-atribuir com nova precedência (PMPL primeiro)
  SELECT * INTO v_result
  FROM public.atribuir_responsavel_ordens_standalone();

  RAISE NOTICE '00076 Backfill concluído: total_analisado=% | preenchidos=% | pmpl=% | refrigeracao=% | cd_fixo=% | fallback=% | sem_destino=% | regras_refrig=% | admins_refrig=%',
    v_result.total_candidatas,
    v_result.responsaveis_preenchidos,
    v_result.atribuicoes_pmpl_config,
    v_result.atribuicoes_refrigeracao,
    v_result.atribuicoes_cd_fixo,
    v_result.atribuicoes_fallback,
    v_result.sem_destino,
    v_result.regras_refrigeracao_encontradas,
    v_result.admins_refrigeracao_elegiveis;
END;
$$;

-- ============================================================
-- CHECKLIST DE VALIDAÇÃO (executar após aplicar a migration)
-- ============================================================
/*
-- V1: Ordens standalone sem destino (deve ser 0 ou mínimo)
SELECT COUNT(*) AS sem_destino
FROM public.ordens_notas_acompanhamento
WHERE nota_id IS NULL
  AND administrador_id IS NULL
  AND status_ordem NOT IN ('concluida', 'cancelada');

-- V2: Distribuição por categoria de roteamento
-- (executar novamente atribuir_responsavel_ordens_standalone em DRY RUN
--  não é trivial; validar via distribuição direta)
SELECT
  a.especialidade,
  COUNT(o.id) AS qtd_ordens
FROM public.ordens_notas_acompanhamento o
JOIN public.administradores a ON a.id = o.administrador_id
WHERE o.nota_id IS NULL
  AND o.status_ordem NOT IN ('concluida', 'cancelada')
GROUP BY a.especialidade
ORDER BY qtd_ordens DESC;

-- V3: PMPL ordens → devem estar com especialidade 'pmpl' ou responsável configurado
SELECT o.tipo_ordem, a.especialidade, a.email, COUNT(*)
FROM public.ordens_notas_acompanhamento o
JOIN public.administradores a ON a.id = o.administrador_id
WHERE o.nota_id IS NULL
  AND o.tipo_ordem = 'PMPL'
  AND o.status_ordem NOT IN ('concluida', 'cancelada')
GROUP BY o.tipo_ordem, a.especialidade, a.email
ORDER BY COUNT(*) DESC;

-- V4: CD routing (TARUMA e MANAUS)
SELECT
  CASE
    WHEN u.unidade ILIKE '%TARUMA%' OR u.unidade ILIKE '%TURISMO%' THEN 'CD_TARUMA'
    WHEN u.unidade ILIKE '%MANAUS%' THEN 'CD_MANAUS'
    ELSE 'OUTROS'
  END AS categoria,
  COUNT(o.id) AS qtd
FROM public.ordens_notas_acompanhamento o
LEFT JOIN public.dim_centro_unidade u ON u.centro = o.centro
WHERE o.nota_id IS NULL
  AND o.status_ordem NOT IN ('concluida', 'cancelada')
GROUP BY 1
ORDER BY qtd DESC;
*/
