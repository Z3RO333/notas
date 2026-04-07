-- 00214_realign_ordem_unidade_from_centro.sql
--
-- Problema:
-- Algumas ordens ficaram com centro corrigido pela fonte operacional/financeira,
-- mas mantiveram unidade stale herdada do bootstrap da nota (ex.: MATRIZ).
-- Isso acontece porque o upsert operacional pode atualizar centro sem enviar
-- unidade, preservando o valor antigo na tabela principal.
--
-- Regra canonica:
-- - centro continua sendo a referencia operacional primaria
-- - quando existir mapeamento em dim_centro_unidade, unidade deve refletir o
--   shortcode canonico correspondente ao centro atual
--
-- Fix:
-- 1. Backfill seguro: normaliza centro e recalcula unidade a partir da dimensao
-- 2. Trigger: sempre que a ordem for inserida/atualizada com centro conhecido,
--    sincroniza automaticamente a unidade canonica

CREATE OR REPLACE FUNCTION public.sync_ordem_unidade_from_centro()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_centro_norm TEXT;
  v_unidade_resolvida TEXT;
BEGIN
  v_centro_norm := public.normalizar_centro_codigo(NEW.centro);

  IF v_centro_norm IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.centro := v_centro_norm;

  SELECT d.unidade
  INTO v_unidade_resolvida
  FROM public.dim_centro_unidade d
  WHERE d.centro = v_centro_norm;

  IF v_unidade_resolvida IS NOT NULL THEN
    NEW.unidade := v_unidade_resolvida;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_ordem_unidade_from_centro() IS
  'Sincroniza unidade canonica de ordens_notas_acompanhamento a partir do centro atual quando houver mapeamento em dim_centro_unidade.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_sync_ordem_unidade_from_centro'
  ) THEN
    CREATE TRIGGER trg_sync_ordem_unidade_from_centro
      BEFORE INSERT OR UPDATE OF centro, unidade
      ON public.ordens_notas_acompanhamento
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_ordem_unidade_from_centro();
  END IF;
END;
$$;

DO $$
DECLARE
  v_atualizadas INTEGER := 0;
BEGIN
  WITH resolved AS MATERIALIZED (
    SELECT
      o.id,
      public.normalizar_centro_codigo(o.centro) AS centro_norm,
      d.unidade AS unidade_resolvida
    FROM public.ordens_notas_acompanhamento o
    LEFT JOIN public.dim_centro_unidade d
      ON d.centro = public.normalizar_centro_codigo(o.centro)
  ),
  atualizadas AS (
    UPDATE public.ordens_notas_acompanhamento o
    SET
      centro = COALESCE(r.centro_norm, o.centro),
      unidade = COALESCE(r.unidade_resolvida, o.unidade),
      updated_at = now()
    FROM resolved r
    WHERE o.id = r.id
      AND (
        (r.centro_norm IS NOT NULL AND o.centro IS DISTINCT FROM r.centro_norm)
        OR (r.unidade_resolvida IS NOT NULL AND o.unidade IS DISTINCT FROM r.unidade_resolvida)
      )
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_atualizadas FROM atualizadas;

  RAISE NOTICE
    '00214 backfill: % ordens com centro/unidade realinhados pela dim_centro_unidade',
    v_atualizadas;
END;
$$;
