-- 00142_fix_criado_por_uuid.sql
--
-- Problema: ordens_notas_acompanhamento.criado_por foi criada como TEXT
-- (migration 00140 chegou antes de 00091 no novo projeto).
-- Isso quebra registrar_ordens_por_notas que faz:
--   COALESCE(ordens_notas_acompanhamento.criado_por, v_criado_por)
-- onde v_criado_por é UUID → "COALESCE types text and uuid cannot be matched".
--
-- Fix:
--   1. Zera criado_por (continha nomes de texto gravados por upload_ordens_data_modif.py)
--   2. Converte a coluna para UUID
--   3. Restaura FK para administradores(id)

-- ============================================================
-- 1. Limpa valores inválidos (nomes texto, não são UUIDs)
-- ============================================================
UPDATE public.ordens_notas_acompanhamento
SET criado_por = NULL
WHERE criado_por IS NOT NULL;

-- ============================================================
-- 2. Converte para UUID
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  ALTER COLUMN criado_por TYPE UUID USING criado_por::UUID;

-- ============================================================
-- 3. Restaura FK (pode já existir se 00091 rodou — DROP IF EXISTS por segurança)
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento
  DROP CONSTRAINT IF EXISTS ordens_notas_acompanhamento_criado_por_fkey;

ALTER TABLE public.ordens_notas_acompanhamento
  ADD CONSTRAINT ordens_notas_acompanhamento_criado_por_fkey
  FOREIGN KEY (criado_por)
  REFERENCES public.administradores(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.criado_por IS
  'Admin que criou a ordem no SAP (UUID de administradores). '
  'Preenchido via sap_user_admin_map em registrar_ordens_por_notas. '
  'Texto SAP bruto vai para criado_por_sap_codigo.';
