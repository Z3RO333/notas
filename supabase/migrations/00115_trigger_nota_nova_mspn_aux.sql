-- Migration 00115: trigger que insere MSPN (ABERTA) em notas_status_sap_aux
-- para cada nota nova que entra no sistema, garantindo visibilidade no cockpit
-- enquanto a planilha SAP não for importada.
-- ON CONFLICT DO NOTHING preserva qualquer status mais recente já existente.

CREATE OR REPLACE FUNCTION public.trg_fn_nota_nova_mspn_aux()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero_norm TEXT;
BEGIN
  -- Normaliza número da nota (remove zeros à esquerda se numérico)
  v_numero_norm := CASE
    WHEN BTRIM(COALESCE(NEW.numero_nota, '')) = '' THEN NULL
    WHEN BTRIM(NEW.numero_nota) ~ '^\d+$'
      THEN COALESCE(NULLIF(LTRIM(BTRIM(NEW.numero_nota), '0'), ''), '0')
    ELSE BTRIM(NEW.numero_nota)
  END;

  IF v_numero_norm IS NULL THEN
    RETURN NEW;
  END IF;

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
  VALUES (
    v_numero_norm,
    NEW.numero_nota,
    'MSPN',
    'ABERTA',
    NULL,
    'auto_trigger_nota_nova',
    gen_random_uuid(),
    NEW.sync_id,
    now()
  )
  ON CONFLICT (numero_nota_norm) DO NOTHING;  -- preserva status da planilha se já existir

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_nota_nova_mspn_aux() IS
  'Insere MSPN (ABERTA) em notas_status_sap_aux para cada nota nova, '
  'garantindo visibilidade no cockpit enquanto a planilha SAP não for importada. '
  'ON CONFLICT DO NOTHING preserva status mais recente já existente.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_nota_nova_mspn_aux'
      AND tgrelid = 'public.notas_manutencao'::regclass
  ) THEN
    CREATE TRIGGER trg_nota_nova_mspn_aux
      AFTER INSERT ON public.notas_manutencao
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_fn_nota_nova_mspn_aux();
  END IF;
END;
$$;
