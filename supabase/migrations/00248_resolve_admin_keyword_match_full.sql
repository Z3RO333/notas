-- 00248_resolve_admin_keyword_match_full.sql
--
-- Causa raiz da OS 5226582 (AR-COND com Rosana em vez de Suelem):
-- registrar_ordens_por_notas() e registrar_ordem_da_nota() chamavam
-- resolve_admin_ordem_sem_nota() com p_descricao = NULL. A funcao ja tinha
-- match por keyword para refrigeracao, mas nunca era acionado.
--
-- Mudancas:
-- 1. resolve_admin_ordem_sem_nota:
--    - Mantem match refrigeracao (ja existia)
--    - Adiciona match elevadores (com downgrade para geral em MONTA CARGA /
--      PLATAFORMA / EMPILHADEIRA, simetrico ao distribuir_notas)
--    - Adiciona override CD 104 + equipamento -> Daniel (cd_manaus_equip)
--    - Mantem fallbacks CD fixo e geral
-- 2. registrar_ordens_por_notas:
--    - Adiciona n.descricao no SELECT inicial
--    - Passa v_nota.descricao para resolve_admin_ordem_sem_nota
-- 3. registrar_ordem_da_nota:
--    - Mesma coisa
-- 4. Backfill cirurgico: ordens AR-COND no pool geral -> Suelem
--    (apenas onde keyword refrigeracao casa)

-- ============================================================
-- 1. resolve_admin_ordem_sem_nota com matching completo
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_admin_ordem_sem_nota(
  p_centro    TEXT,
  p_unidade   TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unidade        TEXT;
  v_admin          UUID;
  v_keyword_esp    TEXT;
  v_eh_movimentacao BOOLEAN;
  v_centro_manaus  BOOLEAN;
BEGIN
  -- Resolve unidade
  v_unidade := COALESCE(p_unidade, (
    SELECT d.unidade FROM public.dim_centro_unidade d WHERE d.centro = p_centro LIMIT 1
  ));

  v_centro_manaus := COALESCE(v_unidade ILIKE '%MANAUS%', false)
                     OR COALESCE(p_centro = '104', false);

  -- ─────────────────────────────────────────────────────────────────────────
  -- A. Match por palavra-chave (keyword mais longa)
  -- ─────────────────────────────────────────────────────────────────────────
  IF p_descricao IS NOT NULL AND BTRIM(p_descricao) <> '' THEN
    SELECT r.especialidade
      INTO v_keyword_esp
    FROM public.regras_distribuicao r
    WHERE UPPER(p_descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ORDER BY LENGTH(r.palavra_chave) DESC NULLS LAST
    LIMIT 1;

    -- Downgrade elevadores -> geral para MONTA CARGA / PLATAFORMA / EMPILHADEIRA
    -- (Gustavo nao recebe mais essas)
    IF v_keyword_esp = 'elevadores' THEN
      v_eh_movimentacao := COALESCE(p_descricao, '') ~* '(MONTA[\s\-]*CARGA|PLATAFORMA|EMPILHADEIRA)';
      IF v_eh_movimentacao THEN
        v_keyword_esp := NULL;
      END IF;
    END IF;

    -- Override CD 104 + equipamento -> Daniel
    IF v_centro_manaus AND public.is_cd_manaus_equipamento(p_descricao) THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'cd_manaus_equip'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;

    -- Refrigeracao
    IF v_keyword_esp = 'refrigeracao' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'refrigeracao'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;

    -- Elevadores (apos downgrade): ELEVADOR / ESCADA ROLANTE / GERADOR / SUBESTACAO
    IF v_keyword_esp = 'elevadores' THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'elevadores'
        AND a.ativo = true
        AND a.em_ferias = false
        AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
             OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      ORDER BY a.nome ASC
      LIMIT 1;
      IF v_admin IS NOT NULL THEN RETURN v_admin; END IF;
    END IF;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- B. CD fixo por unidade (Brenda CD Manaus / Adriano CD Taruma)
  -- ─────────────────────────────────────────────────────────────────────────
  IF v_unidade IS NOT NULL THEN
    SELECT a.id INTO v_admin
    FROM public.administradores a
    WHERE a.ativo = true
      AND a.em_ferias = false
      AND (a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
           OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias)
      AND (
        (a.especialidade = 'cd_taruma' AND (v_unidade ILIKE '%TURISMO%' OR v_unidade ILIKE '%TARUMA%'))
        OR
        (a.especialidade = 'cd_manaus' AND v_unidade ILIKE '%MANAUS%')
      )
    ORDER BY a.nome ASC
    LIMIT 1;
  END IF;

  -- CD Porto Velho → sem dono
  IF v_admin IS NULL AND v_unidade = 'CD PORTO VELHO' THEN
    RETURN NULL;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────
  -- C. Fallback geral
  -- ─────────────────────────────────────────────────────────────────────────
  IF v_admin IS NULL THEN
    v_admin := public.pick_fallback_admin_for_order(p_centro);
  END IF;

  RETURN v_admin;
END;
$function$;

COMMENT ON FUNCTION public.resolve_admin_ordem_sem_nota(TEXT, TEXT, TEXT) IS
  'Resolve admin para ordens sem responsavel: keyword (refrigeracao/elevadores/cd_manaus_equip) -> CD fixo -> fallback geral. Simetrico a distribuir_notas.';

-- ============================================================
-- 2. registrar_ordens_por_notas: passar n.descricao
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id UUID)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por UUID;
  v_admin_efetivo UUID;
  v_detectadas INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
BEGIN
  FOR v_nota IN
    SELECT
      n.id,
      n.numero_nota,
      n.administrador_id,
      n.centro,
      n.status,
      n.data_criacao_sap,
      n.created_at,
      n.ordem_sap,
      n.ordem_gerada,
      n.criado_por_sap,
      n.descricao,
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

    SELECT d.unidade
    INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro, '');

    SELECT m.administrador_id
    INTO v_criado_por
    FROM public.sap_user_admin_map m
    WHERE m.sap_codigo = v_nota.criado_por_sap;

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (CURRENT_DATE - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
        0
      );

      v_admin_efetivo := COALESCE(
        v_nota.administrador_id,
        public.resolve_admin_ordem_sem_nota(v_nota.centro, v_unidade, v_nota.descricao)
      );

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id, numero_nota, ordem_codigo, administrador_id, criado_por,
        centro, unidade, status_ordem_raw, ordem_detectada_em,
        status_atualizado_em, dias_para_gerar_ordem, sync_id
      )
      VALUES (
        v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_admin_efetivo, v_criado_por,
        v_nota.centro, v_unidade, 'ABERTO', now(),
        now(), v_dias_para_gerar, p_sync_id
      )
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico (
        ordem_id, status_anterior, status_novo, status_raw, origem, sync_id
      )
      VALUES (
        v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id
      );

      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento
      SET
        nota_id      = v_nota.id,
        numero_nota  = v_nota.numero_nota,
        administrador_id = CASE
          WHEN v_nota.administrador_id IS NOT NULL
            THEN v_nota.administrador_id
          WHEN ordens_notas_acompanhamento.administrador_id IS NOT NULL
            THEN ordens_notas_acompanhamento.administrador_id
          ELSE public.resolve_admin_ordem_sem_nota(
            COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
            NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''),
            v_nota.descricao
          )
        END,
        criado_por   = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
        centro       = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
        unidade      = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''), v_unidade),
        sync_id      = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
        updated_at   = now()
      WHERE id = v_ordem.id;
    END IF;

    UPDATE public.notas_manutencao
    SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
      updated_at   = now()
    WHERE id = v_nota.id
      AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

    IF v_nota.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao
      SET
        status       = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
        updated_at   = now()
      WHERE id = v_nota.id;

      INSERT INTO public.notas_historico (
        nota_id, campo_alterado, valor_anterior, valor_novo, motivo
      )
      VALUES (
        v_nota.id, 'status', v_nota.status::TEXT, 'concluida',
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_detectadas, v_auto_concluidas;
END;
$function$;

-- ============================================================
-- 3. registrar_ordem_da_nota: idem (versao single-nota)
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordem_da_nota(
  p_nota_id UUID,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por UUID;
  v_admin_efetivo UUID;
BEGIN
  ordens_detectadas := 0;
  notas_auto_concluidas := 0;

  SELECT
    n.id,
    n.numero_nota,
    n.administrador_id,
    n.centro,
    n.status,
    n.data_criacao_sap,
    n.created_at,
    n.ordem_sap,
    n.ordem_gerada,
    n.criado_por_sap,
    n.descricao,
    COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
  INTO v_nota
  FROM public.notas_manutencao n
  LEFT JOIN public.ordens_notas_acompanhamento o
    ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
  WHERE n.id = p_nota_id
    AND COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
    AND (
      o.id IS NULL
      OR o.nota_id IS DISTINCT FROM n.id
      OR o.administrador_id IS DISTINCT FROM n.administrador_id
      OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT ordens_detectadas, notas_auto_concluidas;
    RETURN;
  END IF;

  v_ordem_codigo := v_nota.ordem_codigo;

  SELECT d.unidade INTO v_unidade
  FROM public.dim_centro_unidade d
  WHERE d.centro = COALESCE(v_nota.centro, '');

  SELECT m.administrador_id INTO v_criado_por
  FROM public.sap_user_admin_map m
  WHERE m.sap_codigo = v_nota.criado_por_sap;

  SELECT *
  INTO v_ordem
  FROM public.ordens_notas_acompanhamento o
  WHERE o.ordem_codigo = v_ordem_codigo
  FOR UPDATE;

  IF NOT FOUND THEN
    v_dias_para_gerar := GREATEST(
      (CURRENT_DATE - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
      0
    );

    v_admin_efetivo := COALESCE(
      v_nota.administrador_id,
      public.resolve_admin_ordem_sem_nota(
        v_nota.centro::TEXT,
        v_unidade::TEXT,
        v_nota.descricao::TEXT
      )
    );

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id, numero_nota, ordem_codigo, administrador_id, criado_por,
      centro, unidade, status_ordem_raw, ordem_detectada_em,
      status_atualizado_em, dias_para_gerar_ordem, sync_id
    )
    VALUES (
      v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_admin_efetivo, v_criado_por,
      v_nota.centro, v_unidade, 'ABERTO', now(),
      now(), v_dias_para_gerar, p_sync_id
    )
    RETURNING * INTO v_ordem;

    INSERT INTO public.ordens_notas_historico (
      ordem_id, status_anterior, status_novo, status_raw, origem, sync_id
    )
    VALUES (
      v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id
    );

    ordens_detectadas := ordens_detectadas + 1;
  ELSE
    UPDATE public.ordens_notas_acompanhamento
    SET
      nota_id = v_nota.id,
      numero_nota = v_nota.numero_nota,
      administrador_id = CASE
        WHEN v_nota.administrador_id IS NOT NULL
          THEN v_nota.administrador_id
        WHEN ordens_notas_acompanhamento.administrador_id IS NOT NULL
          THEN ordens_notas_acompanhamento.administrador_id
        ELSE public.resolve_admin_ordem_sem_nota(
          COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro)::TEXT,
          NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), '')::TEXT,
          v_nota.descricao::TEXT
        )
      END,
      criado_por = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
      centro = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.centro), ''), v_nota.centro),
      unidade = COALESCE(NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), ''), v_unidade),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now()
    WHERE id = v_ordem.id;
  END IF;

  UPDATE public.notas_manutencao
  SET
    ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
    updated_at = now()
  WHERE id = v_nota.id
    AND COALESCE(NULLIF(BTRIM(ordem_gerada), ''), '') = '';

  IF v_nota.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor') THEN
    UPDATE public.notas_manutencao
    SET
      status = 'concluida',
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada), ''), v_ordem_codigo),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.notas_historico (
      nota_id, campo_alterado, valor_anterior, valor_novo, motivo
    )
    VALUES (
      v_nota.id, 'status', v_nota.status::TEXT, 'concluida',
      'Auto conclusao: ordem identificada no sync'
    );

    notas_auto_concluidas := notas_auto_concluidas + 1;
  END IF;

  RETURN QUERY SELECT ordens_detectadas, notas_auto_concluidas;
END;
$function$;

-- ============================================================
-- 4. Backfill cirurgico: ordens AR-COND no pool geral -> Suelem
-- ============================================================
DO $$
DECLARE
  v_suelem  UUID;
  v_movidas INTEGER := 0;
BEGIN
  SELECT id INTO v_suelem
  FROM public.administradores
  WHERE especialidade = 'refrigeracao' AND ativo = true
  ORDER BY nome ASC LIMIT 1;

  IF v_suelem IS NULL THEN
    RAISE NOTICE 'Suelem nao encontrada -- pulando backfill';
    RETURN;
  END IF;

  WITH alvo AS (
    SELECT o.id
    FROM public.ordens_notas_acompanhamento o
    JOIN public.administradores a ON a.id = o.administrador_id
    JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE a.especialidade = 'geral'
      AND COALESCE(o.status_ordem_raw,'') NOT IN (
        'CONCLUIDO','CANCELADO','AGUARDANDO_FATURAMENTO_NF',
        'EXECUCAO_SATISFATORIO','EXECUCAO_SATISFATORIA',
        'AVALIACAO_DA_EXECUCAO','AVALIACAO_DE_EXECUCAO'
      )
      AND EXISTS (
        SELECT 1 FROM public.regras_distribuicao r
        WHERE UPPER(n.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
          AND r.especialidade = 'refrigeracao'
      )
  ),
  upd AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET administrador_id = v_suelem,
        updated_at       = now()
    FROM alvo
    WHERE o.id = alvo.id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_movidas FROM upd;

  RAISE NOTICE 'Backfill 00248: % ordens AR-COND movidas pra Suelem', v_movidas;
END $$;
