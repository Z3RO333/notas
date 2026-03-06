-- 00122_index_status_ordem_raw.sql
-- Índice funcional para filtros por status de ordem (UPPER(TRIM(status_ordem_raw))).
-- Cobre todos os padrões de query no painel de ordens.

CREATE INDEX IF NOT EXISTS idx_ordens_status_raw_norm
  ON public.ordens_notas_acompanhamento (UPPER(TRIM(status_ordem_raw)));
