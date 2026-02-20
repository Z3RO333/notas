-- 00025_fix_centro_unidade_backfill.sql
-- Normaliza centro e faz backfill de centro/unidade em ordens originadas de notas

CREATE OR REPLACE FUNCTION public.normalizar_centro_codigo(p_raw TEXT)
RETURNS TEXT AS $$
DECLARE
  v TEXT := NULLIF(BTRIM(COALESCE(p_raw, '')), '');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ex.: "0101", "101.0" -> "101"
  IF v ~ '^[0-9]+(\.0+)?$' THEN
    v := split_part(v, '.', 1);
    v := regexp_replace(v, '^0+', '');
    IF v = '' THEN
      v := '0';
    END IF;
  END IF;

  RETURN v;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1) Normaliza centro já existente nas notas
UPDATE public.notas_manutencao n
SET
  centro = public.normalizar_centro_codigo(n.centro),
  updated_at = now()
WHERE n.centro IS NOT NULL
  AND n.centro IS DISTINCT FROM public.normalizar_centro_codigo(n.centro);

-- 2) Normaliza centro já existente no acompanhamento da ordem
WITH resolved AS (
  SELECT
    o.id,
    public.normalizar_centro_codigo(o.centro) AS centro_resolvido
  FROM public.ordens_notas_acompanhamento o
)
UPDATE public.ordens_notas_acompanhamento o
SET
  centro = r.centro_resolvido,
  updated_at = now()
FROM resolved r
WHERE o.id = r.id
  AND r.centro_resolvido IS NOT NULL
  AND o.centro IS DISTINCT FROM r.centro_resolvido;

-- 3) Recalcula unidade a partir da dimensao de centros
UPDATE public.ordens_notas_acompanhamento o
SET
  unidade = d.unidade,
  updated_at = now()
FROM public.dim_centro_unidade d
WHERE d.centro = public.normalizar_centro_codigo(o.centro)
  AND o.unidade IS DISTINCT FROM d.unidade;
