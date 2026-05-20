-- 00254_pmpl_carteira_rpcs_seed_backfill.sql
--
-- 1. RPC preview_realocar_carteira_pmpl   — leitura: resume impacto antes da confirmação
-- 2. RPC realocar_carteira_pmpl_fornecedor — escrita transacional: troca responsável + backfill + auditoria
-- 3. Seed dos 34 fornecedores mapeados na planilha
-- 4. Backfill das ordens PMPL abertas para os responsáveis definidos

-- ============================================================
-- 1) RPC de preview (somente leitura)
-- ============================================================
DROP FUNCTION IF EXISTS public.preview_realocar_carteira_pmpl(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.preview_realocar_carteira_pmpl(
  p_fornecedor_codigo TEXT,
  p_novo_admin_id     UUID
)
RETURNS TABLE (
  fornecedor_codigo        TEXT,
  fornecedor_nome          TEXT,
  admin_atual_id           UUID,
  admin_atual_nome         TEXT,
  admin_novo_id            UUID,
  admin_novo_nome          TEXT,
  qtd_ordens_abertas       INTEGER,
  qtd_ordens_ignoradas     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo TEXT;
BEGIN
  v_codigo := TRIM(UPPER(p_fornecedor_codigo));

  RETURN QUERY
  SELECT
    c.fornecedor_codigo,
    c.fornecedor_nome,
    c.administrador_id                                                AS admin_atual_id,
    a_atual.nome                                                      AS admin_atual_nome,
    p_novo_admin_id                                                   AS admin_novo_id,
    a_novo.nome                                                       AS admin_novo_nome,
    COUNT(o.id) FILTER (
      WHERE o.status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
    )::INTEGER                                                        AS qtd_ordens_abertas,
    COUNT(o.id) FILTER (
      WHERE o.status_ordem_raw IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
    )::INTEGER                                                        AS qtd_ordens_ignoradas
  FROM public.pmpl_carteira_fornecedor c
  JOIN public.administradores a_atual ON a_atual.id = c.administrador_id
  JOIN public.administradores a_novo  ON a_novo.id  = p_novo_admin_id
  LEFT JOIN public.ordens_notas_acompanhamento o
         ON TRIM(UPPER(o.fornecedor_codigo)) = c.fornecedor_codigo
        AND o.tipo_ordem = 'PMPL'
  WHERE c.fornecedor_codigo = v_codigo
    AND c.ativo = true
  GROUP BY
    c.fornecedor_codigo, c.fornecedor_nome,
    c.administrador_id, a_atual.nome,
    p_novo_admin_id, a_novo.nome;
END;
$$;

COMMENT ON FUNCTION public.preview_realocar_carteira_pmpl IS
  'Retorna resumo do impacto de uma realocação de carteira PMPL antes da confirmação. Somente leitura.';

-- ============================================================
-- 2) RPC de realocação (transacional)
-- ============================================================
DROP FUNCTION IF EXISTS public.realocar_carteira_pmpl_fornecedor(TEXT, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.realocar_carteira_pmpl_fornecedor(
  p_fornecedor_codigo TEXT,
  p_novo_admin_id     UUID,
  p_gestor_id         UUID,
  p_motivo            TEXT DEFAULT NULL
)
RETURNS TABLE (
  fornecedor_codigo           TEXT,
  fornecedor_nome             TEXT,
  admin_anterior_id           UUID,
  admin_anterior_nome         TEXT,
  admin_novo_id               UUID,
  admin_novo_nome             TEXT,
  qtd_ordens_abertas_afetadas INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo              TEXT;
  v_gestor_role         user_role;
  v_novo_admin_ativo    BOOLEAN;
  v_anterior_id         UUID;
  v_anterior_nome       TEXT;
  v_novo_nome           TEXT;
  v_fornecedor_nome     TEXT;
  v_qtd                 INTEGER;
BEGIN
  -- Normaliza código
  v_codigo := TRIM(UPPER(p_fornecedor_codigo));

  -- Valida gestor
  SELECT role INTO v_gestor_role
  FROM public.administradores
  WHERE id = p_gestor_id;

  IF v_gestor_role IS NULL THEN
    RAISE EXCEPTION 'Gestor não encontrado: %', p_gestor_id;
  END IF;

  IF v_gestor_role <> 'gestor' THEN
    RAISE EXCEPTION 'Apenas gestores podem realocar carteiras PMPL.';
  END IF;

  -- Valida novo admin
  SELECT ativo INTO v_novo_admin_ativo
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  IF v_novo_admin_ativo IS NULL THEN
    RAISE EXCEPTION 'Administrador destino não encontrado: %', p_novo_admin_id;
  END IF;

  IF NOT v_novo_admin_ativo THEN
    RAISE EXCEPTION 'Administrador destino está inativo.';
  END IF;

  -- Nome do novo admin
  SELECT nome INTO v_novo_nome
  FROM public.administradores
  WHERE id = p_novo_admin_id;

  -- Lê estado atual (pode ser NULL se fornecedor ainda não mapeado)
  SELECT c.administrador_id, a.nome, c.fornecedor_nome
  INTO v_anterior_id, v_anterior_nome, v_fornecedor_nome
  FROM public.pmpl_carteira_fornecedor c
  JOIN public.administradores a ON a.id = c.administrador_id
  WHERE c.fornecedor_codigo = v_codigo AND c.ativo = true;

  -- UPSERT do vínculo
  INSERT INTO public.pmpl_carteira_fornecedor
    (fornecedor_codigo, fornecedor_nome, administrador_id, ativo, atualizado_em, atualizado_por)
  VALUES
    (v_codigo, v_fornecedor_nome, p_novo_admin_id, true, now(), p_gestor_id)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        atualizado_em    = now(),
        atualizado_por   = p_gestor_id;

  -- Reatribui ordens PMPL abertas desse fornecedor
  UPDATE public.ordens_notas_acompanhamento
  SET administrador_id = p_novo_admin_id,
      updated_at       = now()
  WHERE tipo_ordem = 'PMPL'
    AND TRIM(UPPER(fornecedor_codigo)) = v_codigo
    AND status_ordem_raw NOT IN ('CONCLUIDO', 'CANCELADO', 'FINALIZADO', 'REJEITADA');

  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  -- Auditoria
  INSERT INTO public.pmpl_carteira_audit (
    fornecedor_codigo,
    fornecedor_nome,
    admin_anterior_id,
    admin_anterior_nome,
    admin_novo_id,
    admin_novo_nome,
    qtd_ordens_abertas_afetadas,
    motivo,
    alterado_por,
    alterado_em
  ) VALUES (
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome,
    v_qtd,
    p_motivo,
    p_gestor_id,
    now()
  );

  RETURN QUERY SELECT
    v_codigo,
    v_fornecedor_nome,
    v_anterior_id,
    v_anterior_nome,
    p_novo_admin_id,
    v_novo_nome,
    v_qtd;
END;
$$;

COMMENT ON FUNCTION public.realocar_carteira_pmpl_fornecedor IS
  'Troca o responsável de um fornecedor PMPL, reatribui ordens abertas e grava auditoria. Requer gestor.';

-- ============================================================
-- 3) Seed dos 34 fornecedores mapeados
-- ============================================================
DO $$
DECLARE
  v_mayky   UUID;
  v_wander  UUID;
  v_rosana  UUID;
  v_fabiola UUID;
  v_paula   UUID;
BEGIN
  SELECT id INTO v_mayky   FROM public.administradores WHERE email = 'maykycastro@bemol.com.br';
  SELECT id INTO v_wander  FROM public.administradores WHERE email = 'wanderluciomendes@bemol.com.br';
  SELECT id INTO v_rosana  FROM public.administradores WHERE email = 'rosanafigueira@bemol.com.br';
  SELECT id INTO v_fabiola FROM public.administradores WHERE email = 'fabiolatentunge@bemol.com.br';
  SELECT id INTO v_paula   FROM public.administradores WHERE email = 'paulamatos@bemol.com.br';

  IF v_mayky   IS NULL THEN RAISE EXCEPTION 'Admin Mayky não encontrado'; END IF;
  IF v_wander  IS NULL THEN RAISE EXCEPTION 'Admin Wanderlucio não encontrado'; END IF;
  IF v_rosana  IS NULL THEN RAISE EXCEPTION 'Admin Rosana não encontrado'; END IF;
  IF v_fabiola IS NULL THEN RAISE EXCEPTION 'Admin Fabíola não encontrado'; END IF;
  IF v_paula   IS NULL THEN RAISE EXCEPTION 'Admin Paula não encontrado'; END IF;

  INSERT INTO public.pmpl_carteira_fornecedor (fornecedor_codigo, fornecedor_nome, administrador_id)
  VALUES
    -- Mayky: Grupo Gerador / Subestação
    ('101',   'CLAUDIO ANDRADE JUNIOR',                    v_mayky),

    -- Wanderlucio: Controle de Pragas / ETE / Elétrica / Equipamentos Operacionais
    ('8059',  'EMOPS CONTROLE AMBIENTAL LTDA EPP',         v_wander),
    ('10364', 'NASCIMENTO E CORDEIRO LTDA - ME',           v_wander),
    ('10171', 'LUSIVAM OLIVEIRA MAIA',                     v_wander),
    ('16744', 'E. O. SOUZA',                               v_wander),
    ('19233', 'DAVID BEZERRA VIANA',                       v_wander),
    ('7949',  'ACQUALIMP PRODUTOS QUIMICOS LTDA - ME',     v_wander),

    -- Rosana: Elevadores / Pragas / Incêndio / Água
    ('41',    'ELEVADORES ATLAS S/A',                      v_rosana),
    ('12034', 'MODULO ENGENHARIA CONSULTORIA E GERENCIA',  v_rosana),
    ('9214',  'J I PINTO DOS SANTOS ME',                   v_rosana),
    ('10745', 'BIOTECH SOLUCOES EM BIOTECONOLOGIA LTDA',   v_rosana),
    ('15327', 'EVANCLEY S. DE MELO - ME',                  v_rosana),
    ('9331',  'C&SERVICE',                                 v_rosana),
    ('17162', 'C.E.S MELO',                                v_rosana),
    ('500',   'FABITECK SANEAMENTO LTDA',                  v_rosana),
    ('13609', 'SRS TECNOLOGIA EM INSTALACOES LTDA',        v_rosana),

    -- Fabíola: Dedetização / Elevadores / Água / Incêndio / Gerador
    ('15202', 'SERVICOS DE DEDETIZACAO',                   v_fabiola),
    ('6405',  'ELEVADORES OTIS LTDA',                      v_fabiola),
    ('11371', 'FERREIRA E FERREIRA COMERCIO E SERVICOS',   v_fabiola),
    ('16513', 'AMAZONTEC SOLUCOES',                        v_fabiola),
    ('12947', 'ENGEMON-INSTALACAO E MANUTENCAO ELETRICA',  v_fabiola),
    ('13400', 'THYSSENKRUPP ELEVADORES SA',                v_fabiola),
    ('16119', 'PARINTINS CONTROLE DE PRAGAS',              v_fabiola),
    ('12697', 'QUALYANALISE AMBIENTAL SERVICOS DE TESTE',  v_fabiola),
    ('11231', 'POTABILIZA PERF E CONST DE POCOS EIRELI',   v_fabiola),

    -- Paula: Elevadores / Gerador / Pragas / Bromatologia / Incêndio
    ('1188',  'LUPA ANALISES BROMATOLOGICAS LTDA',         v_paula),
    ('18052', 'UZZIENERGY COMERCIALIZADORA DE ENER',       v_paula),
    ('14604', 'MAKARIOS EMPREENDIMENTO',                   v_paula),
    ('672',   'THYSSENKRUPP ELEVADORES S/A',               v_paula),
    ('15594', 'PROTECTA TECNOLOGIA',                       v_paula),
    ('13851', 'LABORATORIO HESSEL PERIN LTDA',             v_paula),
    ('13166', 'PENHA E SILVEIRA LTDA - EPP',               v_paula),
    ('16904', 'ERINALDO MARINHO RIBEIRO - ME',             v_paula),
    ('17017', 'BEATRIZ DE OLIVEIRA SILVA - ME',            v_paula)
  ON CONFLICT (fornecedor_codigo) DO UPDATE
    SET administrador_id = EXCLUDED.administrador_id,
        fornecedor_nome  = EXCLUDED.fornecedor_nome,
        atualizado_em    = now();

  RAISE NOTICE 'Seed: 34 fornecedores PMPL inseridos/atualizados.';
END;
$$;

-- ============================================================
-- 4) Backfill: reatribui ordens PMPL abertas conforme a carteira
-- ============================================================
DO $$
DECLARE
  v_backfill_total INTEGER := 0;
  v_gestor_id      UUID;
  v_rec            RECORD;
  v_qtd            INTEGER;
  v_anterior_id    UUID;
  v_anterior_nome  TEXT;
  v_novo_nome      TEXT;
BEGIN
  -- Usa Walter como autor do backfill técnico
  SELECT id INTO v_gestor_id
  FROM public.administradores
  WHERE email = 'walterrodrigues@bemol.com.br';

  IF v_gestor_id IS NULL THEN
    -- Fallback: qualquer gestor ativo
    SELECT id INTO v_gestor_id
    FROM public.administradores
    WHERE role = 'gestor' AND ativo = true
    LIMIT 1;
  END IF;

  FOR v_rec IN
    SELECT c.fornecedor_codigo, c.fornecedor_nome, c.administrador_id,
           a.nome AS admin_nome
    FROM public.pmpl_carteira_fornecedor c
    JOIN public.administradores a ON a.id = c.administrador_id
    WHERE c.ativo = true
  LOOP
    -- Responsável anterior predominante (antes da reatribuição)
    SELECT o.administrador_id, a2.nome
    INTO v_anterior_id, v_anterior_nome
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.administradores a2 ON a2.id = o.administrador_id
    WHERE TRIM(UPPER(o.fornecedor_codigo)) = v_rec.fornecedor_codigo
      AND o.tipo_ordem = 'PMPL'
      AND o.status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
      AND o.administrador_id IS DISTINCT FROM v_rec.administrador_id
    LIMIT 1;

    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_rec.administrador_id,
        updated_at       = now()
    WHERE tipo_ordem = 'PMPL'
      AND TRIM(UPPER(fornecedor_codigo)) = v_rec.fornecedor_codigo
      AND status_ordem_raw NOT IN ('CONCLUIDO','CANCELADO','FINALIZADO','REJEITADA')
      AND administrador_id IS DISTINCT FROM v_rec.administrador_id;

    GET DIAGNOSTICS v_qtd = ROW_COUNT;

    IF v_qtd > 0 THEN
      INSERT INTO public.pmpl_carteira_audit (
        fornecedor_codigo, fornecedor_nome,
        admin_anterior_id, admin_anterior_nome,
        admin_novo_id, admin_novo_nome,
        qtd_ordens_abertas_afetadas,
        motivo, alterado_por, alterado_em
      ) VALUES (
        v_rec.fornecedor_codigo, v_rec.fornecedor_nome,
        v_anterior_id, v_anterior_nome,
        v_rec.administrador_id, v_rec.admin_nome,
        v_qtd,
        'Seed inicial — carteira PMPL por fornecedor (migration 00254)',
        v_gestor_id,
        now()
      );

      v_backfill_total := v_backfill_total + v_qtd;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill concluído: % ordens PMPL reatribuídas.', v_backfill_total;
END;
$$;
