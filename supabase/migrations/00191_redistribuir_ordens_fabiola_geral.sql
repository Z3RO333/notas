-- 00191_redistribuir_ordens_fabiola_geral.sql
--
-- Problema:
-- 1. O backfill da 00190 concentrou tudo na Fabíola (contador de carga usava
--    notas_manutencao, não ordens — não atualizava entre iterações).
-- 2. resolve_admin_ordem_sem_nota não checava keywords de refrigeração →
--    ordens de AR CONDICIONADO foram pra geral em vez da Suelem.
--
-- Solução:
-- 1. Atualiza resolve_admin_ordem_sem_nota para aceitar p_descricao e rotear
--    para refrigeração quando há match de keyword.
-- 2. Corrige pick_fallback_admin_for_order para contar ordens ativas.
-- 3. Redistribui as ordens do backfill:
--    - keyword refrigeração → Suelem
--    - resto → round-robin geral

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Atualiza resolve_admin_ordem_sem_nota com suporte a keyword refrigeração
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_admin_ordem_sem_nota(
  p_centro   TEXT,
  p_unidade  TEXT DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL
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

  -- Refrigeração: keyword match → admin especialidade = 'refrigeracao'
  IF v_admin IS NULL AND p_descricao IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.regras_distribuicao r
      WHERE r.especialidade = 'refrigeracao'
        AND UPPER(p_descricao) LIKE '%' || UPPER(r.palavra_chave) || '%'
    ) THEN
      SELECT a.id INTO v_admin
      FROM public.administradores a
      WHERE a.especialidade = 'refrigeracao'
        AND a.ativo         = true
        AND a.em_ferias     = false
        AND (
          a.data_inicio_ferias IS NULL OR a.data_fim_ferias IS NULL
          OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
        )
      ORDER BY a.nome ASC
      LIMIT 1;
    END IF;
  END IF;

  -- Fallback geral (apenas para ordens que não são de CD sem dono)
  IF v_admin IS NULL THEN
    v_admin := public.pick_fallback_admin_for_order(p_centro);
  END IF;

  RETURN v_admin;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Corrige pick_fallback_admin_for_order
--    Métrica: ordens ativas em vez de notas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pick_fallback_admin_for_order(
  p_centro TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID;
BEGIN
  SELECT a.id
  INTO v_admin_id
  FROM public.administradores a
  LEFT JOIN public.ordens_notas_acompanhamento o
    ON o.administrador_id = a.id
   AND NOT public.status_raw_eh_final(o.status_ordem_raw)
  WHERE a.role                 = 'admin'
    AND a.especialidade        = 'geral'
    AND a.ativo                = true
    AND a.recebe_distribuicao  = true
    AND a.em_ferias            = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    )
  GROUP BY a.id, a.nome
  ORDER BY COUNT(o.id) ASC, a.nome ASC
  LIMIT 1;

  RETURN v_admin_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Redistribuição das ordens do backfill
--    - Refrigeração → Suelem
--    - Resto → round-robin geral (partindo do menos carregado)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_ordem   RECORD;
  v_destino UUID;
  v_total   INTEGER := 0;
BEGIN

  FOR v_ordem IN
    SELECT o.id, o.centro, o.unidade, n.descricao
    FROM public.ordens_notas_acompanhamento o
    JOIN public.notas_manutencao n ON n.id = o.nota_id
    WHERE o.nota_id IS NOT NULL
      AND n.administrador_id IS NULL
      AND NOT public.status_raw_eh_final(o.status_ordem_raw)
    ORDER BY o.id
  LOOP
    -- Usa o roteamento completo: CD Manaus/Tarumã → fixo, CD PVH → NULL,
    -- refrigeração keyword → Suelem, resto → pick_fallback_admin_for_order
    v_destino := public.resolve_admin_ordem_sem_nota(
      v_ordem.centro,
      v_ordem.unidade,
      v_ordem.descricao
    );

    UPDATE public.ordens_notas_acompanhamento
    SET administrador_id = v_destino,
        updated_at       = now()
    WHERE id = v_ordem.id;

    v_total := v_total + 1;
  END LOOP;

  RAISE NOTICE 'Redistribuição concluída: % ordens redistribuídas.', v_total;
END $$;
