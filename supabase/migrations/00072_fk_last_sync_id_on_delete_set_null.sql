-- 00072_fk_last_sync_id_on_delete_set_null.sql
--
-- Problema: ordens_tipo_documento_referencia e ordens_manutencao_referencia
-- têm FK last_sync_id → sync_log(id) sem ON DELETE.
-- Se sync_log for truncado (ex: reset manual) enquanto o job está rodando,
-- qualquer upsert subsequente com o sync_id deletado viola a FK.
--
-- Fix: mudar para ON DELETE SET NULL em ambas as tabelas.
-- O campo last_sync_id é apenas rastreabilidade — NULL é aceitável.

-- ============================================================
-- 1) ordens_tipo_documento_referencia
-- ============================================================
ALTER TABLE public.ordens_tipo_documento_referencia
  DROP CONSTRAINT IF EXISTS ordens_tipo_documento_referencia_last_sync_id_fkey;

ALTER TABLE public.ordens_tipo_documento_referencia
  ADD CONSTRAINT ordens_tipo_documento_referencia_last_sync_id_fkey
  FOREIGN KEY (last_sync_id)
  REFERENCES public.sync_log(id)
  ON DELETE SET NULL;

-- ============================================================
-- 2) ordens_manutencao_referencia (mesma FK, mesmo padrão)
-- ============================================================
ALTER TABLE public.ordens_manutencao_referencia
  DROP CONSTRAINT IF EXISTS ordens_manutencao_referencia_last_sync_id_fkey;

ALTER TABLE public.ordens_manutencao_referencia
  ADD CONSTRAINT ordens_manutencao_referencia_last_sync_id_fkey
  FOREIGN KEY (last_sync_id)
  REFERENCES public.sync_log(id)
  ON DELETE SET NULL;
