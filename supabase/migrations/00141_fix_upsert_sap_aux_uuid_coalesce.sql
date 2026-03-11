-- 00141_fix_upsert_sap_aux_uuid_coalesce.sql
--
-- Problema: PostgREST merge-duplicates gera COALESCE(EXCLUDED.lote_id, table.lote_id)
-- onde EXCLUDED.lote_id é inferido como text (vem do JSON) mas table.lote_id é UUID.
-- PostgreSQL rejeita o COALESCE com tipos incompatíveis.
--
-- Fix: RPC que faz o upsert explicitamente com tipos corretos, evitando o COALESCE
-- automático do PostgREST.

CREATE OR REPLACE FUNCTION public.importar_notas_status_sap_aux(
  p_records JSONB
)
RETURNS TABLE(inseridas INTEGER, atualizadas INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridas   INTEGER := 0;
  v_atualizadas INTEGER := 0;
BEGIN
  WITH input AS (
    SELECT
      (rec->>'numero_nota_norm')                        AS numero_nota_norm,
      (rec->>'numero_nota_original')                    AS numero_nota_original,
      (rec->>'status_raw')                              AS status_raw,
      (rec->>'status_canonico')                         AS status_canonico,
      (rec->>'data_exportacao')::DATE                   AS data_exportacao,
      (rec->>'arquivo_origem')                          AS arquivo_origem,
      (rec->>'lote_id')::UUID                           AS lote_id,
      (rec->>'sync_id')::UUID                           AS sync_id,
      (rec->>'importado_em')::TIMESTAMPTZ               AS importado_em
    FROM jsonb_array_elements(p_records) AS rec
  ),
  upserted AS (
    INSERT INTO public.notas_status_sap_aux (
      numero_nota_norm,
      numero_nota_original,
      status_raw,
      status_canonico,
      data_exportacao,
      arquivo_origem,
      lote_id,
      sync_id,
      importado_em
    )
    SELECT
      numero_nota_norm,
      numero_nota_original,
      status_raw,
      status_canonico,
      data_exportacao,
      arquivo_origem,
      lote_id,
      sync_id,
      importado_em
    FROM input
    ON CONFLICT (numero_nota_norm) DO UPDATE SET
      numero_nota_original = EXCLUDED.numero_nota_original,
      status_raw           = EXCLUDED.status_raw,
      status_canonico      = EXCLUDED.status_canonico,
      data_exportacao      = EXCLUDED.data_exportacao,
      arquivo_origem       = EXCLUDED.arquivo_origem,
      lote_id              = EXCLUDED.lote_id,
      sync_id              = EXCLUDED.sync_id,
      importado_em         = EXCLUDED.importado_em,
      updated_at           = now()
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT
    COUNT(*) FILTER (WHERE is_insert)::INTEGER,
    COUNT(*) FILTER (WHERE NOT is_insert)::INTEGER
  INTO v_inseridas, v_atualizadas
  FROM upserted;

  RETURN QUERY SELECT v_inseridas, v_atualizadas;
END;
$$;

COMMENT ON FUNCTION public.importar_notas_status_sap_aux(JSONB) IS
  'Upsert de registros em notas_status_sap_aux com tipagem explícita de UUID. '
  'Evita o erro COALESCE types text and uuid do PostgREST merge-duplicates. '
  'Chamada pelo sync job Python em lugar do upsert direto via PostgREST.';
