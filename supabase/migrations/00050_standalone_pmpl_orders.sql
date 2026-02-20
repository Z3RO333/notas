-- 00050_standalone_pmpl_orders.sql
-- Permite ordens PMPL (manutenção planejada) sem nota correspondente.
--
-- Mudanças:
-- 1. nota_id passa a ser nullable em ordens_notas_acompanhamento
-- 2. Nova RPC importar_ordens_pmpl_standalone — upsert de ordens PMPL standalone

-- ============================================================
-- 1) nota_id NULLABLE
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  ALTER COLUMN nota_id DROP NOT NULL;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.nota_id IS
  'Nota de origem. NULL para ordens PMPL importadas diretamente da fonte sem nota correspondente.';

-- ============================================================
-- 2) RPC importar_ordens_pmpl_standalone
-- ============================================================
CREATE OR REPLACE FUNCTION public.importar_ordens_pmpl_standalone(
  p_orders  JSONB,
  p_sync_id UUID DEFAULT NULL
)
RETURNS TABLE(total_recebidas INTEGER, inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_item           JSONB;
  v_ordem_codigo   TEXT;
  v_status_raw     TEXT;
  v_status_novo    public.ordem_status_acomp;
  v_centro         TEXT;
  v_unidade        TEXT;
  v_data_raw       TEXT;
  v_data_entrada   TIMESTAMPTZ;
  v_tipo_ordem     TEXT;
  v_exists         BOOLEAN;
  v_total          INTEGER := 0;
  v_inseridas      INTEGER := 0;
  v_atualizadas    INTEGER := 0;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array' THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    v_total        := v_total + 1;
    v_ordem_codigo := NULLIF(BTRIM(v_item ->> 'ordem_codigo'), '');
    IF v_ordem_codigo IS NULL THEN CONTINUE; END IF;

    v_status_raw  := NULLIF(BTRIM(v_item ->> 'status_raw'), '');
    v_status_novo := public.normalizar_status_ordem(v_status_raw);
    v_centro      := NULLIF(BTRIM(v_item ->> 'centro'), '');
    v_tipo_ordem  := COALESCE(NULLIF(BTRIM(v_item ->> 'tipo_ordem'), ''), 'PMPL');

    v_data_raw     := NULLIF(BTRIM(v_item ->> 'data_entrada'), '');
    v_data_entrada := NULL;
    IF v_data_raw IS NOT NULL THEN
      BEGIN
        v_data_entrada := v_data_raw::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        v_data_entrada := NULL;
      END;
    END IF;

    IF v_centro IS NOT NULL THEN
      SELECT d.unidade INTO v_unidade
      FROM public.dim_centro_unidade d
      WHERE d.centro = v_centro;
    ELSE
      v_unidade := NULL;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.ordens_notas_acompanhamento
      WHERE ordem_codigo = v_ordem_codigo
    ) INTO v_exists;

    INSERT INTO public.ordens_notas_acompanhamento (
      nota_id,
      ordem_codigo,
      status_ordem,
      status_ordem_raw,
      centro,
      unidade,
      data_entrada,
      tipo_ordem,
      sync_id,
      ordem_detectada_em
    )
    VALUES (
      NULL,
      v_ordem_codigo,
      v_status_novo,
      v_status_raw,
      v_centro,
      v_unidade,
      v_data_entrada,
      v_tipo_ordem,
      p_sync_id,
      COALESCE(v_data_entrada, now())
    )
    ON CONFLICT (ordem_codigo) DO UPDATE
    SET
      status_ordem       = EXCLUDED.status_ordem,
      status_ordem_raw   = COALESCE(EXCLUDED.status_ordem_raw,  ordens_notas_acompanhamento.status_ordem_raw),
      centro             = COALESCE(EXCLUDED.centro,            ordens_notas_acompanhamento.centro),
      unidade            = COALESCE(EXCLUDED.unidade,           ordens_notas_acompanhamento.unidade),
      data_entrada       = CASE
        WHEN EXCLUDED.data_entrada IS NULL                      THEN ordens_notas_acompanhamento.data_entrada
        WHEN ordens_notas_acompanhamento.data_entrada IS NULL   THEN EXCLUDED.data_entrada
        ELSE LEAST(ordens_notas_acompanhamento.data_entrada, EXCLUDED.data_entrada)
      END,
      tipo_ordem         = COALESCE(EXCLUDED.tipo_ordem,        ordens_notas_acompanhamento.tipo_ordem),
      status_atualizado_em = now(),
      sync_id            = COALESCE(EXCLUDED.sync_id,           ordens_notas_acompanhamento.sync_id),
      updated_at         = now();

    IF v_exists THEN
      v_atualizadas := v_atualizadas + 1;
    ELSE
      v_inseridas := v_inseridas + 1;
    END IF;

  END LOOP;

  RETURN QUERY SELECT v_total, v_inseridas, v_atualizadas;
END;
$$;
