-- 00056_orders_manut_ref_last_seen_index.sql
-- Acelera leitura do watermark da referência v2 (last_seen_at DESC LIMIT 1).

CREATE INDEX IF NOT EXISTS idx_ordens_manut_ref_last_seen
  ON public.ordens_manutencao_referencia (last_seen_at DESC);
