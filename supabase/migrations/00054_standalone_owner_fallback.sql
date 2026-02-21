-- 00054_standalone_owner_fallback.sql
-- Atribuição automática de responsável para ordens standalone sem dono.
--
-- Mudanças:
-- 1. Guard de dependências (00043 + 00053)
-- 2. pick_fallback_admin_for_order: adiciona recebe_distribuicao + férias por intervalo
-- 3. Nova RPC atribuir_responsavel_ordens_standalone
-- 4. View vw_ordens_notas_painel: responsavel_atual_id = COALESCE(n.admin, o.admin)

-- ============================================================
-- 0) GUARD DE DEPENDÊNCIAS
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'responsaveis_tipo_ordem'
  ) THEN
    RAISE EXCEPTION 'Dependência não satisfeita: responsaveis_tipo_ordem não encontrada. Aplicar migration 00043 primeiro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'ordens_manutencao_referencia'
  ) THEN
    RAISE EXCEPTION 'Dependência não satisfeita: ordens_manutencao_referencia não encontrada. Aplicar migration 00053 primeiro.';
  END IF;
END
$$;

-- ============================================================
-- 1) ATUALIZAR pick_fallback_admin_for_order
--    Adiciona: recebe_distribuicao = true
--              verificação de férias por intervalo de datas
-- ============================================================
CREATE OR REPLACE FUNCTION public.pick_fallback_admin_for_order(
  p_centro TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  -- p_centro mantido para evolução futura por unidade.
  SELECT a.id
  INTO v_admin_id
  FROM public.administradores a
  LEFT JOIN public.notas_manutencao n
    ON n.administrador_id = a.id
  WHERE a.role = 'admin'
    AND a.ativo = true
    AND a.recebe_distribuicao = true
    AND a.em_ferias = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    )
  GROUP BY a.id, a.nome
  ORDER BY
    COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) ASC,
    a.nome ASC
  LIMIT 1;

  RETURN v_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.pick_fallback_admin_for_order(TEXT) IS
  'Admin com menor carga ativo, recebe_distribuicao=true e fora de ferias (booleano + intervalo de datas).';

-- ============================================================
-- 2) NOVA RPC atribuir_responsavel_ordens_standalone
--    Escopo: nota_id IS NULL AND administrador_id IS NULL
--    Precedência: refrigeração → PMPL config → fallback menor carga
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
        -- Sem admin de refrigeração elegível: fallback geral
        v_destino   := public.pick_fallback_admin_for_order(v_ordem.centro);
        v_categoria := 'fallback';
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
    -- PASSO 3: PMOS / outros → fallback menor carga
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
  'Precedência: refrigeração → PMPL config → fallback menor carga. Idempotente por escopo.';

-- ============================================================
-- 3) VIEW vw_ordens_notas_painel — responsavel_atual via COALESCE
--    Única mudança vs migration 00045:
--      base CTE: COALESCE(n.administrador_id, o.administrador_id) AS responsavel_atual_id
--      JOIN atual: ON atual.id = COALESCE(n.administrador_id, o.administrador_id)
--    Efeito: ordens standalone com o.administrador_id preenchido passam a exibir responsavel.
--    Regressão: para notas normais, n.administrador_id != NULL → COALESCE retorna mesmo valor.
-- ============================================================
CREATE OR REPLACE VIEW public.vw_ordens_notas_painel AS
WITH historico AS (
  SELECT
    na.nota_id,
    COUNT(*)::BIGINT AS qtd_historico,
    ARRAY_AGG(DISTINCT na.administrador_id) AS historico_admin_ids
  FROM public.nota_acompanhamentos na
  GROUP BY na.nota_id
),
base AS (
  SELECT
    o.id AS ordem_id,
    o.nota_id,
    o.numero_nota,
    o.ordem_codigo,
    o.administrador_id,
    origem.nome AS administrador_nome,
    COALESCE(n.administrador_id, o.administrador_id) AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    COALESCE(o.data_entrada, o.ordem_detectada_em) AS ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao,
    o.tipo_ordem
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
  LEFT JOIN public.administradores origem ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual ON atual.id = COALESCE(n.administrador_id, o.administrador_id)
  LEFT JOIN public.dim_centro_unidade d ON d.centro = o.centro
  LEFT JOIN historico h ON h.nota_id = o.nota_id
)
SELECT
  b.ordem_id,
  b.nota_id,
  b.numero_nota,
  b.ordem_codigo,
  b.administrador_id,
  b.administrador_nome,
  b.responsavel_atual_id,
  b.responsavel_atual_nome,
  b.centro,
  b.unidade,
  b.status_ordem,
  b.status_ordem_raw,
  b.ordem_detectada_em,
  b.status_atualizado_em,
  b.dias_para_gerar_ordem,
  b.qtd_historico,
  (b.qtd_historico > 0) AS tem_historico,
  CASE
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 0
    ELSE GREATEST((current_date - b.ordem_detectada_em::date), 0)
  END::INTEGER AS dias_em_aberto,
  CASE
    WHEN b.status_ordem IN ('concluida', 'cancelada') THEN 'neutro'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 7 THEN 'vermelho'
    WHEN GREATEST((current_date - b.ordem_detectada_em::date), 0) >= 3 THEN 'amarelo'
    ELSE 'verde'
  END AS semaforo_atraso,
  ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      b.historico_admin_ids
      || ARRAY[b.administrador_id, b.responsavel_atual_id]
    ) AS x
    WHERE x IS NOT NULL
  ) AS envolvidos_admin_ids,
  b.descricao,
  b.tipo_ordem
FROM base b;
