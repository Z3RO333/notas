-- 00215_auto_reroute_cd_orders_when_note_has_no_owner.sql
--
-- Problema:
-- Ordens PMOS vinculadas a nota podem nascer no fallback geral quando a nota
-- ainda nao tem administrador_id e o bootstrap detecta centro/unidade errados
-- (ex.: MATRIZ). Depois, quando a fonte operacional corrige o centro para
-- CD MANAUS / CD TARUMA, o dono da ordem pode continuar no card do geral.
--
-- Regra canonica:
-- - se a nota tem administrador_id, a carteira da nota prevalece
-- - se a nota NAO tem administrador_id, ordens PMOS de CD fixo devem seguir o
--   roteamento especifico do CD, nao permanecer no fallback geral
--
-- Fix:
-- 1. Helper dedicado para resolver apenas donos de CD fixo
-- 2. Trigger conservador em ordens_notas_acompanhamento:
--    reatribui somente quando centro/unidade/nota mudam e a nota continua sem
--    dono, evitando sobrescrever reatribuicoes manuais
-- 3. Backfill explicito de ordens ativas nota-vinculadas que ainda estejam no
--    geral apesar de agora pertencerem a CD MANAUS / CD TARUMA

CREATE OR REPLACE FUNCTION public.resolve_admin_cd_fixo_por_unidade(
  p_centro TEXT,
  p_unidade TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_unidade TEXT;
  v_admin UUID;
BEGIN
  v_unidade := COALESCE(
    NULLIF(BTRIM(p_unidade), ''),
    (
      SELECT d.unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = public.normalizar_centro_codigo(p_centro)
      LIMIT 1
    )
  );

  IF v_unidade IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.id
  INTO v_admin
  FROM public.administradores a
  WHERE a.ativo = true
    AND a.em_ferias = false
    AND (
      a.data_inicio_ferias IS NULL
      OR a.data_fim_ferias IS NULL
      OR CURRENT_DATE NOT BETWEEN a.data_inicio_ferias AND a.data_fim_ferias
    )
    AND (
      (
        a.especialidade = 'cd_taruma'
        AND (
          v_unidade ILIKE '%TURISMO%'
          OR v_unidade ILIKE '%TARUMA%'
        )
      )
      OR (
        a.especialidade = 'cd_manaus'
        AND v_unidade ILIKE '%MANAUS%'
      )
    )
  ORDER BY a.nome ASC
  LIMIT 1;

  RETURN v_admin;
END;
$function$;

COMMENT ON FUNCTION public.resolve_admin_cd_fixo_por_unidade(TEXT, TEXT) IS
  'Resolve apenas responsaveis fixos de CD (Manaus/Taruma) a partir de centro/unidade, sem cair no fallback geral.';

CREATE OR REPLACE FUNCTION public.sync_ordem_admin_cd_fixo_quando_nota_sem_dono()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_nota_admin UUID;
  v_admin_atual_especialidade TEXT;
  v_destino UUID;
BEGIN
  IF NEW.nota_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF UPPER(COALESCE(NULLIF(BTRIM(NEW.tipo_ordem), ''), 'PMOS')) = 'PMPL' THEN
    RETURN NEW;
  END IF;

  SELECT n.administrador_id
  INTO v_nota_admin
  FROM public.notas_manutencao n
  WHERE n.id = NEW.nota_id;

  IF v_nota_admin IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.administrador_id IS NOT NULL THEN
    SELECT a.especialidade
    INTO v_admin_atual_especialidade
    FROM public.administradores a
    WHERE a.id = NEW.administrador_id;

    IF v_admin_atual_especialidade IS NOT NULL
       AND v_admin_atual_especialidade <> 'geral' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_destino := public.resolve_admin_cd_fixo_por_unidade(NEW.centro, NEW.unidade);

  IF v_destino IS NOT NULL
     AND NEW.administrador_id IS DISTINCT FROM v_destino THEN
    NEW.administrador_id := v_destino;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_ordem_admin_cd_fixo_quando_nota_sem_dono() IS
  'Reatribui ordens nota-vinculadas para CD fixo quando a nota permanece sem dono e centro/unidade passam a identificar CD Manaus/Taruma.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_sync_ordem_admin_cd_fixo_quando_nota_sem_dono'
  ) THEN
    CREATE TRIGGER trg_sync_ordem_admin_cd_fixo_quando_nota_sem_dono
      BEFORE INSERT OR UPDATE OF nota_id, centro, unidade, tipo_ordem
      ON public.ordens_notas_acompanhamento
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_ordem_admin_cd_fixo_quando_nota_sem_dono();
  END IF;
END;
$$;

DO $$
DECLARE
  v_atualizadas INTEGER := 0;
BEGIN
  WITH candidatos AS MATERIALIZED (
    SELECT
      o.id,
      public.resolve_admin_cd_fixo_por_unidade(o.centro, o.unidade) AS destino_id
    FROM public.ordens_notas_acompanhamento o
    JOIN public.notas_manutencao n
      ON n.id = o.nota_id
    LEFT JOIN public.administradores atual
      ON atual.id = o.administrador_id
    WHERE o.nota_id IS NOT NULL
      AND n.administrador_id IS NULL
      AND UPPER(COALESCE(NULLIF(BTRIM(o.tipo_ordem), ''), 'PMOS')) <> 'PMPL'
      AND NOT public.status_raw_eh_final(o.status_ordem_raw)
      AND (
        o.administrador_id IS NULL
        OR atual.especialidade = 'geral'
      )
  ),
  atualizadas AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      administrador_id = c.destino_id,
      updated_at = now()
    FROM candidatos c
    WHERE o.id = c.id
      AND c.destino_id IS NOT NULL
      AND o.administrador_id IS DISTINCT FROM c.destino_id
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_atualizadas FROM atualizadas;

  RAISE NOTICE
    '00215 backfill: % ordens ativas reatribuidas do geral para CD fixo com nota sem dono',
    v_atualizadas;
END;
$$;
