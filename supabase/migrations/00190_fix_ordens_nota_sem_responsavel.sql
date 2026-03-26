-- 00190_fix_ordens_nota_sem_responsavel.sql
--
-- Problema:
-- Ordens vinculadas a notas (nota_id IS NOT NULL) onde a nota não tem
-- administrador_id nascem com administrador_id = NULL e nunca são cobertas
-- por atribuir_responsavel_ordens_standalone() (que só processa nota_id IS NULL).
-- Resultado: ordens ativas "sem responsável" no painel, como visto na OS 5224144.
--
-- Raiz:
-- registrar_ordens_por_notas() faz:
--   INSERT ... administrador_id = v_nota.administrador_id
-- Sem fallback — se a nota não tem admin, a ordem nasce NULL e fica assim.
--
-- Solução:
-- 1. Função resolve_admin_ordem_sem_nota(): encapsula a cadeia de roteamento
--    (CD fixo → fallback geral) para uso como fallback quando a nota não tem admin.
-- 2. Atualiza registrar_ordens_por_notas(): aplica o fallback na hora de criar
--    e atualizar ordens cujas notas não têm administrador_id.
-- 3. Cria backfill_ordens_nota_sem_responsavel(): corrige ordens já existentes.
-- 4. Executa o backfill imediatamente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Função auxiliar: resolve admin via CD routing → geral fallback
--    (mesma precedência do atribuir_responsavel_ordens_standalone PASSO 3-4)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_admin_ordem_sem_nota(
  p_centro  TEXT,
  p_unidade TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unidade TEXT;
  v_admin   UUID;
BEGIN
  -- Resolve unidade se não fornecida
  v_unidade := COALESCE(p_unidade, (
    SELECT d.unidade FROM public.dim_centro_unidade d WHERE d.centro = p_centro LIMIT 1
  ));

  -- CD Taruma / Turismo → Adriano
  -- CD Manaus → Brenda
  IF v_unidade IS NOT NULL THEN
    SELECT a.id INTO v_admin
    FROM public.administradores a
    WHERE a.ativo = true
      AND a.em_ferias = false
      AND (
        a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
        OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
      )
      AND (
        (a.especialidade = 'cd_taruma' AND (v_unidade ILIKE '%TURISMO%' OR v_unidade ILIKE '%TARUMA%'))
        OR
        (a.especialidade = 'cd_manaus' AND v_unidade ILIKE '%MANAUS%')
      )
    ORDER BY a.nome ASC
    LIMIT 1;
  END IF;

  -- CD Porto Velho → sem responsável fixo, não vai pro fallback geral
  IF v_admin IS NULL AND v_unidade = 'CD PORTO VELHO' THEN
    RETURN NULL;
  END IF;

  -- Fallback geral (apenas para ordens que não são de CD sem dono)
  IF v_admin IS NULL THEN
    v_admin := public.pick_fallback_admin_for_order(p_centro);
  END IF;

  RETURN v_admin;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atualiza registrar_ordens_por_notas()
-- ─────────────────────────────────────────────────────────────────────────────
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

      -- Nota sem admin → aplica roteamento CD → fallback geral
      v_admin_efetivo := COALESCE(
        v_nota.administrador_id,
        public.resolve_admin_ordem_sem_nota(v_nota.centro, v_unidade)
      );

      INSERT INTO public.ordens_notas_acompanhamento (
        nota_id,
        numero_nota,
        ordem_codigo,
        administrador_id,
        criado_por,
        centro,
        unidade,
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
        v_admin_efetivo,
        v_criado_por,
        v_nota.centro,
        v_unidade,
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
      -- UPDATE: mantém admin existente se a nota não tem.
      -- Se ambos são NULL, resolve via CD routing → fallback geral.
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
            NULLIF(BTRIM(ordens_notas_acompanhamento.unidade), '')
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
        nota_id,
        campo_alterado,
        valor_anterior,
        valor_novo,
        motivo
      )
      VALUES (
        v_nota.id,
        'status',
        v_nota.status::TEXT,
        'concluida',
        'Auto conclusao: ordem identificada no sync'
      );

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT v_detectadas, v_auto_concluidas;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill reutilizável para ordens nota-vinculadas sem responsável
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_ordens_nota_sem_responsavel()
RETURNS TABLE(total_candidatas INTEGER, atribuidas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ordem RECORD;
  v_destino UUID;
  v_total INTEGER := 0;
  v_atribuidas INTEGER := 0;
BEGIN
  FOR v_ordem IN
    SELECT o.id, o.centro, o.unidade
    FROM public.ordens_notas_acompanhamento o
    JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE o.nota_id IS NOT NULL
      AND o.administrador_id IS NULL
      AND n.administrador_id IS NULL
      AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  LOOP
    v_total := v_total + 1;
    -- CD Manaus → Brenda, CD Taruma → Adriano, senão fallback geral
    v_destino := public.resolve_admin_ordem_sem_nota(v_ordem.centro, v_ordem.unidade);
    IF v_destino IS NOT NULL THEN
      UPDATE public.ordens_notas_acompanhamento
      SET administrador_id = v_destino, updated_at = now()
      WHERE id = v_ordem.id;
      v_atribuidas := v_atribuidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_total, v_atribuidas;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill imediato
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.backfill_ordens_nota_sem_responsavel();
  RAISE NOTICE 'Backfill ordens-nota sem responsável: % candidatas, % atribuídas',
    v_result.total_candidatas, v_result.atribuidas;
END $$;
