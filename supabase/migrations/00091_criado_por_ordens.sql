-- 00091_criado_por_ordens.sql
-- Adiciona criado_por (admin que criou a ordem no SAP) em ordens_notas_acompanhamento.
-- Cria sap_user_admin_map para mapear código SAP do usuário → administrador_id.
-- Backfill: propaga para as 3068 ordens existentes sem admin usando nota.criado_por_sap.
-- Atualiza registrar_ordens_por_notas para setar criado_por nos inserts futuros.

-- ============================================================
-- 1. Coluna criado_por em ordens_notas_acompanhamento
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  ADD COLUMN IF NOT EXISTS criado_por UUID
    REFERENCES public.administradores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.criado_por IS
  'Admin que criou a ordem no SAP (mapeado via sap_user_admin_map a partir de notas_manutencao.criado_por_sap). '
  'Permite atribuir ordens órfãs (sem administrador_id) ao criador original.';

-- ============================================================
-- 2. Tabela de mapeamento código SAP → administrador
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sap_user_admin_map (
  sap_codigo        TEXT        NOT NULL,
  administrador_id  UUID        NOT NULL REFERENCES public.administradores(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sap_user_admin_map_pkey PRIMARY KEY (sap_codigo)
);

COMMENT ON TABLE public.sap_user_admin_map IS
  'Mapeamento de código de usuário SAP (CRIADO_POR / ERNAM) → administrador_id. '
  'Usado para atribuir criado_por nas ordens a partir de notas_manutencao.criado_por_sap.';

-- ============================================================
-- 3. Seed: 8 admins com seus códigos SAP
-- ============================================================
INSERT INTO public.sap_user_admin_map (sap_codigo, administrador_id)
SELECT v.sap_codigo, a.id
FROM (VALUES
  ('10175', 'fabiola'),
  ('12686', 'rosana'),
  ('11924', 'paula'),
  ('15856', 'suelem'),
  ('17542', 'adriano'),
  ('20504', 'mayky'),
  ('10093', 'wanderlucio'),
  ('21075', 'brenda')
) AS v(sap_codigo, nome_parcial)
JOIN public.administradores a
  ON a.nome ILIKE '%' || v.nome_parcial || '%'
ON CONFLICT (sap_codigo) DO NOTHING;

-- Validação: confirma que todos os 8 foram inseridos
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.sap_user_admin_map;
  RAISE NOTICE 'sap_user_admin_map: % registros inseridos', v_count;
  IF v_count < 8 THEN
    RAISE WARNING 'Esperado 8 mapeamentos, encontrado %. Verifique os nomes dos admins.', v_count;
  END IF;
END;
$$;

-- ============================================================
-- 4. Backfill: preenche criado_por nas ordens existentes
-- ============================================================
WITH atualizar AS (
  UPDATE public.ordens_notas_acompanhamento ona
  SET
    criado_por = m.administrador_id,
    updated_at = now()
  FROM public.notas_manutencao nm
  JOIN public.sap_user_admin_map m ON m.sap_codigo = nm.criado_por_sap
  WHERE nm.id = ona.nota_id
    AND ona.criado_por IS NULL
    AND nm.criado_por_sap IS NOT NULL
  RETURNING ona.id
)
SELECT COUNT(*) AS ordens_backfill FROM atualizar;

-- Log do backfill
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.ordens_notas_acompanhamento
  WHERE criado_por IS NOT NULL;
  RAISE NOTICE 'criado_por preenchido em % ordens', v_count;
END;
$$;

-- ============================================================
-- 5. Atualiza registrar_ordens_por_notas para setar criado_por
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_ordens_por_notas(p_sync_id uuid)
RETURNS TABLE(ordens_detectadas integer, notas_auto_concluidas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nota            RECORD;
  v_ordem           public.ordens_notas_acompanhamento%ROWTYPE;
  v_ordem_codigo    TEXT;
  v_unidade         TEXT;
  v_dias_para_gerar INTEGER;
  v_criado_por      UUID;
  v_detectadas      INTEGER := 0;
  v_auto_concluidas INTEGER := 0;
BEGIN
  FOR v_nota IN
    SELECT n.id, n.numero_nota, n.administrador_id, n.centro, n.status,
      n.data_criacao_sap, n.created_at, n.ordem_sap, n.ordem_gerada,
      n.criado_por_sap,
      COALESCE(NULLIF(BTRIM(n.ordem_sap),''), NULLIF(BTRIM(n.ordem_gerada),'')) AS ordem_codigo
    FROM public.notas_manutencao n
    LEFT JOIN public.ordens_notas_acompanhamento o
      ON o.ordem_codigo = COALESCE(NULLIF(BTRIM(n.ordem_sap),''), NULLIF(BTRIM(n.ordem_gerada),''))
    WHERE COALESCE(NULLIF(BTRIM(n.ordem_sap),''), NULLIF(BTRIM(n.ordem_gerada),'')) IS NOT NULL
      AND (o.id IS NULL OR o.nota_id IS DISTINCT FROM n.id OR o.administrador_id IS DISTINCT FROM n.administrador_id
        OR n.status IN ('nova','em_andamento','encaminhada_fornecedor') OR COALESCE(NULLIF(BTRIM(n.ordem_gerada),''),'') = '')
  LOOP
    v_ordem_codigo := v_nota.ordem_codigo;

    -- Resolve unidade via dim_centro_unidade
    SELECT d.unidade INTO v_unidade
    FROM public.dim_centro_unidade d
    WHERE d.centro = COALESCE(v_nota.centro,'');

    -- Resolve criado_por via sap_user_admin_map
    SELECT m.administrador_id INTO v_criado_por
    FROM public.sap_user_admin_map m
    WHERE m.sap_codigo = v_nota.criado_por_sap;

    SELECT * INTO v_ordem
    FROM public.ordens_notas_acompanhamento o
    WHERE o.ordem_codigo = v_ordem_codigo
    FOR UPDATE;

    IF NOT FOUND THEN
      v_dias_para_gerar := GREATEST(
        (current_date - COALESCE(v_nota.data_criacao_sap, v_nota.created_at::date)), 0
      );
      INSERT INTO public.ordens_notas_acompanhamento
        (nota_id, numero_nota, ordem_codigo, administrador_id, criado_por, centro, unidade,
         status_ordem, status_ordem_raw, ordem_detectada_em, status_atualizado_em,
         dias_para_gerar_ordem, sync_id)
      VALUES
        (v_nota.id, v_nota.numero_nota, v_ordem_codigo, v_nota.administrador_id, v_criado_por,
         v_nota.centro, v_unidade, 'aberta', 'ABERTO', now(), now(), v_dias_para_gerar, p_sync_id)
      RETURNING * INTO v_ordem;

      INSERT INTO public.ordens_notas_historico
        (ordem_id, status_anterior, status_novo, status_raw, origem, sync_id)
      VALUES (v_ordem.id, NULL, 'aberta', 'ABERTO', 'detectada_na_nota', p_sync_id);

      v_detectadas := v_detectadas + 1;
    ELSE
      UPDATE public.ordens_notas_acompanhamento SET
        nota_id          = v_nota.id,
        numero_nota      = v_nota.numero_nota,
        administrador_id = COALESCE(v_nota.administrador_id, ordens_notas_acompanhamento.administrador_id),
        criado_por       = COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por),
        centro           = COALESCE(v_nota.centro, ordens_notas_acompanhamento.centro),
        unidade          = COALESCE(v_unidade, ordens_notas_acompanhamento.unidade),
        sync_id          = COALESCE(p_sync_id, ordens_notas_acompanhamento.sync_id),
        updated_at       = now()
      WHERE id = v_ordem.id;
    END IF;

    -- Atualiza ordem_gerada na nota se ainda vazio
    UPDATE public.notas_manutencao SET
      ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada),''), v_ordem_codigo),
      updated_at = now()
    WHERE id = v_nota.id
      AND COALESCE(NULLIF(BTRIM(ordem_gerada),''),'') = '';

    -- Auto-conclui nota aberta que já tem ordem
    IF v_nota.status IN ('nova','em_andamento','encaminhada_fornecedor') THEN
      UPDATE public.notas_manutencao SET
        status       = 'concluida',
        ordem_gerada = COALESCE(NULLIF(BTRIM(ordem_gerada),''), v_ordem_codigo),
        updated_at   = now()
      WHERE id = v_nota.id;

      INSERT INTO public.notas_historico
        (nota_id, campo_alterado, valor_anterior, valor_novo, motivo)
      VALUES
        (v_nota.id, 'status', v_nota.status::TEXT, 'concluida',
         'Auto conclusão: ordem identificada no sync');

      v_auto_concluidas := v_auto_concluidas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_detectadas, v_auto_concluidas;
END;
$function$;

COMMENT ON FUNCTION public.registrar_ordens_por_notas(uuid) IS
  'Detecta ordens em notas_manutencao, insere em ordens_notas_acompanhamento e auto-conclui notas abertas. '
  'Preenche criado_por via sap_user_admin_map (lookup por notas_manutencao.criado_por_sap).';
