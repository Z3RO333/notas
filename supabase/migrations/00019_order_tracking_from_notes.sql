-- 00019_order_tracking_from_notes.sql
-- Acompanhamento de ordens originadas de notas (SAP + manual), com status e semáforo

-- ============================================================
-- 1) ENUM DE STATUS DE ACOMPANHAMENTO
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ordem_status_acomp'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.ordem_status_acomp AS ENUM (
      'aberta',
      'em_tratativa',
      'concluida',
      'cancelada',
      'desconhecido'
    );
  END IF;
END;
$$;

-- ============================================================
-- 2) TABELAS NOVAS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ordens_notas_acompanhamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES public.notas_manutencao(id) ON DELETE CASCADE,
  numero_nota TEXT NOT NULL,
  ordem_codigo TEXT NOT NULL,
  administrador_id UUID REFERENCES public.administradores(id),
  centro TEXT,
  unidade TEXT,
  status_ordem public.ordem_status_acomp NOT NULL DEFAULT 'aberta',
  status_ordem_raw TEXT,
  ordem_detectada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_atualizado_em TIMESTAMPTZ,
  dias_para_gerar_ordem INTEGER,
  sync_id UUID REFERENCES public.sync_log(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ordens_notas_acompanhamento_codigo UNIQUE (ordem_codigo)
);

CREATE TABLE IF NOT EXISTS public.ordens_notas_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_id UUID NOT NULL REFERENCES public.ordens_notas_acompanhamento(id) ON DELETE CASCADE,
  status_anterior public.ordem_status_acomp,
  status_novo public.ordem_status_acomp NOT NULL,
  status_raw TEXT,
  origem TEXT NOT NULL,
  sync_id UUID REFERENCES public.sync_log(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dim_centro_unidade (
  centro TEXT PRIMARY KEY,
  unidade TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_nota
  ON public.ordens_notas_acompanhamento (nota_id);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_admin
  ON public.ordens_notas_acompanhamento (administrador_id);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_status
  ON public.ordens_notas_acompanhamento (status_ordem);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_acompanhamento_detectada
  ON public.ordens_notas_acompanhamento (ordem_detectada_em DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_historico_ordem
  ON public.ordens_notas_historico (ordem_id);

CREATE INDEX IF NOT EXISTS idx_ordens_notas_historico_created
  ON public.ordens_notas_historico (created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_ordens_notas_acompanhamento_updated'
  ) THEN
    CREATE TRIGGER trg_ordens_notas_acompanhamento_updated
      BEFORE UPDATE ON public.ordens_notas_acompanhamento
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.ordens_notas_acompanhamento DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_notas_historico DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_centro_unidade DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) DIMENSAO CENTRO -> UNIDADE
-- ============================================================
INSERT INTO public.dim_centro_unidade (centro, unidade)
VALUES
  ('101', 'MATRIZ'),
  ('103', 'AVENIDA'),
  ('104', 'CD MANAUS'),
  ('105', 'EDUCANDOS'),
  ('106', 'AMAZONAS SHOPPING'),
  ('109', 'GRANDE CIRCULAR'),
  ('114', 'PONTA NEGRA'),
  ('115', 'CIDADE NOVA'),
  ('116', 'SHOPPING STUDIO 5'),
  ('117', 'SHOPPING MILLENNIUM'),
  ('118', 'CAMAPUA'),
  ('119', 'SHOPPING MANAUARA'),
  ('120', 'SHOPPING PONTA NEGRA'),
  ('121', 'NOVA CIDADE'),
  ('144', 'CD II'),
  ('148', 'CD TARUMA'),
  ('149', 'CD FARMA TARUMA'),
  ('170', 'CD PORTO'),
  ('201', 'PORTO VELHO CENTRO'),
  ('202', 'SHOPPING PORTO VELHO'),
  ('203', 'CD PORTO VELHO'),
  ('204', 'JATUARANA'),
  ('205', 'JI-PARANA'),
  ('206', 'ARIQUEMES'),
  ('401', 'RIO BRANCO'),
  ('402', 'CD RIO BRANCO'),
  ('404', 'CRUZEIRO DO SUL'),
  ('500', 'TORQUATO'),
  ('510', 'ITACOATIARA'),
  ('520', 'MANACAPURU'),
  ('530', 'PRESIDENTE FIGUEIREDO'),
  ('531', 'AUTAZES'),
  ('550', 'IRANDUBA'),
  ('560', 'RIO PRETO'),
  ('561', 'CODAJAS'),
  ('570', 'MANAQUIRI'),
  ('580', 'CAREIRO'),
  ('590', 'PARINTINS'),
  ('591', 'COARI'),
  ('592', 'MAUES'),
  ('601', 'BEMOL FARMA TORQUATO'),
  ('602', 'FARMA CAMAPUA'),
  ('603', 'BEMOL FARMA AMAZONAS SHOPPING'),
  ('604', 'FARMA GRANDE CIRCULAR'),
  ('605', 'BEMOL FARMA MATRIZ'),
  ('606', 'BEMOL FARMA SHOPPING PONTA NEGRA'),
  ('607', 'BEMOL FARMA NOVA CIDADE'),
  ('609', 'FARMA PORTO VELHO'),
  ('610', 'FARMA BOA VISTA'),
  ('611', 'FARMA ITACOATIARA'),
  ('612', 'FARMA MANAUARA'),
  ('613', 'FARMA ARIQUEMES'),
  ('614', 'BEMOL FARMA PRESIDENTE FIGUEIREDO'),
  ('615', 'FARMA DJALMA'),
  ('616', 'FARMA JI-PARANA'),
  ('617', 'FARMA PONTA NEGRA DB'),
  ('618', 'FARMA STUDIO 5'),
  ('619', 'FARMA JATUARANA'),
  ('620', 'FARMA AVENIDA'),
  ('621', 'FARMA CIDADE NOVA'),
  ('622', 'FARMA AUTAZES'),
  ('623', 'FARMA ATAIDE TEIVE'),
  ('624', 'FARMA MANACAPURU'),
  ('625', 'FARMA RIO BRANCO'),
  ('626', 'FARMA RORAINOPOLIS'),
  ('627', 'FARMA GETULIO VARGAS'),
  ('628', 'FARMA EDUARDO GOMES'),
  ('629', 'FARMA RIO PRETO'),
  ('630', 'FARMA CODAJAS'),
  ('631', 'FARMA PORTO VELHO SHOPPING'),
  ('632', 'FARMA CRUZEIRO DO SUL'),
  ('633', 'FARMA MANAQUIRI'),
  ('634', 'FARMA MAJOR WILLIAMS'),
  ('635', 'FARMA CAREIRO'),
  ('636', 'FARMA DOM PEDRO'),
  ('637', 'FARMA BOULEVARD'),
  ('638', 'BEMOL FARMA IRANDUBA'),
  ('639', 'BEMOL FARMA PARINTINS'),
  ('640', 'BEMOL FARMA COARI'),
  ('641', 'BEMOL FARMA EDUCANDOS'),
  ('642', 'FARMA VIA NORTE'),
  ('643', 'FARMA EFIGENIO SALLES'),
  ('644', 'FARMA FRANCESES'),
  ('645', 'FARMA COROADO'),
  ('647', 'FARMA AV. DAS TORRES'),
  ('648', 'FARMA NOEL NUTELS'),
  ('649', 'FARMA FLORES'),
  ('699', 'FARMA TORRES ONLINE'),
  ('701', 'SHOPPING BOA VISTA'),
  ('702', 'ATAIDE TEIVE'),
  ('703', 'RORAINOPOLIS'),
  ('704', 'CD BOA VISTA'),
  ('705', 'GETULIO VARGAS'),
  ('706', 'MAJOR WILLIAMS')
ON CONFLICT (centro) DO UPDATE SET unidade = EXCLUDED.unidade;

-- ============================================================
-- 4) NORMALIZACAO DE STATUS DE ORDEM
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalizar_status_ordem(p_raw TEXT)
RETURNS public.ordem_status_acomp AS $$
DECLARE
  v_raw TEXT := UPPER(BTRIM(COALESCE(p_raw, '')));
BEGIN
  IF v_raw = '' THEN
    RETURN 'desconhecido';
  END IF;

  IF v_raw IN ('ABERTO') THEN
    RETURN 'aberta';
  END IF;

  IF v_raw IN (
    'EM_PROCESSAMENTO',
    'EM_EXECUCAO',
    'AVALIACAO_DA_EXECUCAO',
    'EQUIPAMENTO_EM_CONSERTO',
    'EXECUCAO_NAO_REALIZADA',
    'ENVIAR_EMAIL_PFORNECEDOR'
  ) THEN
    RETURN 'em_tratativa';
  END IF;

  IF v_raw IN (
    'CONCLUIDO',
    'AGUARDANDO_FATURAMENTO_NF',
    'EXECUCAO_SATISFATORIO'
  ) THEN
    RETURN 'concluida';
  END IF;

  IF v_raw = 'CANCELADO' THEN
    RETURN 'cancelada';
  END IF;

  RETURN 'desconhecido';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 5) REGISTRA ORDENS A PARTIR DE NOTAS COM ORDEM PREENCHIDA
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(
  p_sync_id UUID
)
RETURNS TABLE(ordens_detectadas INTEGER, notas_auto_concluidas INTEGER) AS $$
DECLARE
  v_nota RECORD;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_unidade TEXT;
  v_dias_para_gerar INTEGER;
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
      COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), ''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap), ''), NULLIF(BTRIM(n.ordem_gerada), '')) IS NOT NULL
      AND (
        o.id IS NULL
        OR o.nota_id IS DISTINCT FROM n.id
        OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR o.centro IS DISTINCT FROM n.centro
        OR n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        OR COALESCE(NULLIF(BTRIM(n.ordem_gerada), ''), '') = ''
      )
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

    SELECT d.unidade
    INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro, '');

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (current_date - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)),
        0
      );

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id,
        numero_nota,
        ordem_codigo,
        administrador_id,
        centro,
        unidade,
        status_ordem,
        status_ordem_raw,
        ordem_detectada_em,
        status_atualizado_em,
        dias_para_gerar_ordem,
        sync_id
      )
      VALUES (
        v_nota.id,
        v_nota.numero_nota,
        v_ordem_codigo,
        v_nota.administrador_id,
        v_nota.centro,
        v_unidade,
        'aberta',
        'ABERTO',
        now(),
        now(),
        v_dias_para_gerar,
        p_sync_id
      )
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        NULL,
        'aberta',
        'ABERTO',
        'detectada_na_nota',
        p_sync_id
      );

      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento
      SET
        nota_id = v_nota.id,
        numero_nota = v_nota.numero_nota,
        administrador_id = COALESCE(v_nota.administrador_id, ordens_notas_acompanhamento.administrador_id),
        centro = COALESCE(v_nota.centro, ordens_notas_acompanhamento.centro),
        unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
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
        nota_id,
        campo_alterado,
        valor_anterior,
        valor_novo,
        alterado_por,
        motivo
      )
      VALUES (
        v_nota.id,
        'status',
        v_nota.status::TEXT,
        'concluida',
        NULL,
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_detectadas, v_auto_concluidas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6) ATUALIZA STATUS DE ORDEM A PARTIR DO PMPL (LOTE)
-- ============================================================
CREATE OR REPLACE FUNCTION public.atualizar_status_ordens_pmpl_lote(
  p_updates JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, ordens_atualizadas INTEGER, mudancas_status INTEGER) AS $$
DECLARE
  v_item JSONB;
  v_ordem public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo TEXT;
  v_status_raw TEXT;
  v_status_novo public.ordem_status_acomp;
  v_centro TEXT;
  v_unidade TEXT;
  v_total INTEGER := 0;
  v_atualizadas INTEGER := 0;
  v_mudancas INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_total := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');

    IF v_ordem_codigo IS NULL THEN
      CONTINUE;
    END IF;

    v_status_raw := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo := public.normalizar_status_ordem(v_status_raw);
    v_centro := NULLIF(BTRIM(v_item ->> 'centro'), '');

    SELECT *
    INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    UPDATE public.ordens_notas_acompanhamento
    SET
      status_ordem = v_status_novo,
      status_ordem_raw = COALESCE(v_status_raw, ordens_notas_acompanhamento.status_ordem_raw),
      centro = COALESCE(v_centro, ordens_notas_acompanhamento.centro),
      unidade = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
      status_atualizado_em = now(),
      sync_id = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
      updated_at = now()
    WHERE id = v_ordem.id;

    v_atualizadas := v_atualizadas + 1;

    IF v_ordem.status_ordem IS DISTINCT FROM v_status_novo THEN
      INSERT INTO public.ordens_notas_historico (
        ordem_id,
        status_anterior,
        status_novo,
        status_raw,
        origem,
        sync_id
      )
      VALUES (
        v_ordem.id,
        v_ordem.status_ordem,
        v_status_novo,
        v_status_raw,
        'pmpl_sync',
        p_sync_id
      );

      v_mudancas := v_mudancas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_atualizadas, v_mudancas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7) BLOQUEAR DISTRIBUICAO AUTOMATICA PARA NOTAS COM ORDEM
-- ============================================================
CREATE OR REPLACE FUNCTION distribuir_notas(p_sync_id UUID DEFAULT NULL)
RETURNS TABLE(nota_id UUID, administrador_id UUID, notas_abertas INTEGER) AS $$
#variable_conflict use_column
DECLARE
  v_nota RECORD;
  v_admin RECORD;
  v_especialidade TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('distribuir_notas'));

  FOR v_nota IN
    SELECT nm.id, nm.descricao
    FROM public.notas_manutencao nm
    WHERE nm.status = 'nova'
      AND nm.administrador_id IS NULL
      AND COALESCE(NULLIF(BTRIM(nm.ordem_sap), ''), NULLIF(BTRIM(nm.ordem_gerada), '')) IS NULL
    ORDER BY nm.data_criacao_sap ASC NULLS LAST, nm.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT r.especialidade INTO v_especialidade
    FROM public.regras_distribuicao r
    WHERE UPPER(v_nota.descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    LIMIT 1;

    IF v_especialidade IS NULL THEN
      v_especialidade := 'geral';
    END IF;

    SELECT
      a.id,
      COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      )::INTEGER AS open_count
    INTO v_admin
    FROM public.administradores a
    LEFT JOIN public.notas_manutencao n
      ON n.administrador_id = a.id
    WHERE a.ativo = true
      AND a.recebe_distribuicao = true
      AND a.em_ferias = false
      AND a.especialidade = v_especialidade
    GROUP BY a.id, a.max_notas, a.nome
    HAVING COUNT(n.id) FILTER (
      WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    ) < a.max_notas
    ORDER BY open_count ASC, a.nome ASC
    LIMIT 1;

    IF v_admin IS NULL AND v_especialidade != 'geral' THEN
      SELECT
        a.id,
        COUNT(n.id) FILTER (
          WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
        )::INTEGER AS open_count
      INTO v_admin
      FROM public.administradores a
      LEFT JOIN public.notas_manutencao n
        ON n.administrador_id = a.id
      WHERE a.ativo = true
        AND a.recebe_distribuicao = true
        AND a.em_ferias = false
        AND a.especialidade = 'geral'
      GROUP BY a.id, a.max_notas, a.nome
      HAVING COUNT(n.id) FILTER (
        WHERE n.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
      ) < a.max_notas
      ORDER BY open_count ASC, a.nome ASC
      LIMIT 1;
    END IF;

    IF v_admin IS NULL THEN
      EXIT;
    END IF;

    UPDATE public.notas_manutencao
    SET
      administrador_id = v_admin.id,
      distribuida_em = now(),
      updated_at = now()
    WHERE id = v_nota.id;

    INSERT INTO public.distribuicao_log (nota_id, administrador_id, notas_abertas_no_momento, sync_id)
    VALUES (v_nota.id, v_admin.id, v_admin.open_count, p_sync_id);

    INSERT INTO public.notas_historico (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
    VALUES (
      v_nota.id,
      'administrador_id',
      NULL,
      v_admin.id::TEXT,
      'Distribuição automatica (' || v_especialidade || ') - sync_id: ' || COALESCE(p_sync_id::TEXT, 'manual')
    );

    nota_id := v_nota.id;
    administrador_id := v_admin.id;
    notas_abertas := v_admin.open_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8) VIEWS DE PAINEL
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
    n.administrador_id AS responsavel_atual_id,
    atual.nome AS responsavel_atual_nome,
    o.centro,
    COALESCE(o.unidade, d.unidade) AS unidade,
    o.status_ordem,
    o.status_ordem_raw,
    o.ordem_detectada_em,
    o.status_atualizado_em,
    o.dias_para_gerar_ordem,
    COALESCE(h.qtd_historico, 0)::BIGINT AS qtd_historico,
    COALESCE(h.historico_admin_ids, ARRAY[]::UUID[]) AS historico_admin_ids,
    n.descricao
  FROM public.ordens_notas_acompanhamento o
  LEFT JOIN public.notas_manutencao n ON n.id = o.nota_id
  LEFT JOIN public.administradores origem ON origem.id = o.administrador_id
  LEFT JOIN public.administradores atual ON atual.id = n.administrador_id
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
  b.descricao
FROM base b;

CREATE OR REPLACE VIEW public.vw_ordens_notas_ranking_admin_30d AS
SELECT
  a.id AS administrador_id,
  a.nome,
  COUNT(v.ordem_id)::BIGINT AS qtd_ordens_30d,
  COUNT(v.ordem_id) FILTER (WHERE v.status_ordem = 'aberta')::BIGINT AS qtd_abertas_30d,
  COUNT(v.ordem_id) FILTER (WHERE v.status_ordem = 'em_tratativa')::BIGINT AS qtd_em_tratativa_30d,
  COUNT(v.ordem_id) FILTER (WHERE v.status_ordem = 'concluida')::BIGINT AS qtd_concluidas_30d,
  COUNT(v.ordem_id) FILTER (WHERE v.status_ordem = 'cancelada')::BIGINT AS qtd_canceladas_30d,
  COUNT(v.ordem_id) FILTER (WHERE v.semaforo_atraso = 'vermelho')::BIGINT AS qtd_antigas_7d_30d,
  ROUND(AVG(v.dias_para_gerar_ordem)::NUMERIC, 2) AS tempo_medio_geracao_dias_30d
FROM public.administradores a
LEFT JOIN public.vw_ordens_notas_painel v
  ON v.administrador_id = a.id
  AND v.ordem_detectada_em >= now() - INTERVAL '30 days'
WHERE a.role = 'admin'
GROUP BY a.id, a.nome
ORDER BY qtd_ordens_30d DESC, a.nome ASC;

CREATE OR REPLACE VIEW public.vw_ordens_notas_ranking_unidade_30d AS
SELECT
  COALESCE(v.unidade, 'Sem unidade') AS unidade,
  COUNT(*)::BIGINT AS qtd_ordens_30d,
  COUNT(*) FILTER (WHERE v.status_ordem = 'aberta')::BIGINT AS qtd_abertas_30d,
  COUNT(*) FILTER (WHERE v.status_ordem = 'em_tratativa')::BIGINT AS qtd_em_tratativa_30d,
  COUNT(*) FILTER (WHERE v.semaforo_atraso = 'vermelho')::BIGINT AS qtd_antigas_7d_30d,
  ROUND(AVG(v.dias_para_gerar_ordem)::NUMERIC, 2) AS tempo_medio_geracao_dias_30d
FROM public.vw_ordens_notas_painel v
WHERE v.ordem_detectada_em >= now() - INTERVAL '30 days'
GROUP BY COALESCE(v.unidade, 'Sem unidade')
ORDER BY qtd_ordens_30d DESC, unidade ASC;

CREATE OR REPLACE VIEW public.vw_ordens_notas_kpis AS
WITH base AS (
  SELECT *
  FROM public.vw_ordens_notas_painel
  WHERE ordem_detectada_em >= now() - INTERVAL '30 days'
)
SELECT
  COUNT(*)::BIGINT AS total_ordens_30d,
  COUNT(*) FILTER (WHERE status_ordem = 'aberta')::BIGINT AS qtd_abertas_30d,
  COUNT(*) FILTER (WHERE status_ordem = 'em_tratativa')::BIGINT AS qtd_em_tratativa_30d,
  COUNT(*) FILTER (WHERE status_ordem = 'concluida')::BIGINT AS qtd_concluidas_30d,
  COUNT(*) FILTER (WHERE status_ordem = 'cancelada')::BIGINT AS qtd_canceladas_30d,
  COUNT(*) FILTER (WHERE semaforo_atraso = 'vermelho')::BIGINT AS qtd_antigas_7d_30d,
  ROUND(AVG(dias_para_gerar_ordem)::NUMERIC, 2) AS tempo_medio_geracao_dias_30d
FROM base;
