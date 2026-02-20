-- 00037_orders_data_entrada_historical_backfill.sql
-- Backfill histórico de data_entrada com alta confianca e suporte ao sweep PMPL.

-- Ajuda a varredura do sync para preencher ordens ainda sem DATA_ENTRADA.
CREATE INDEX IF NOT EXISTS idx_ordens_sem_data_entrada_codigo
  ON public.ordens_notas_acompanhamento (ordem_codigo)
  WHERE data_entrada IS NULL;

-- Backfill seguro:
-- quando ordem_detectada_em difere muito de created_at, costuma ser data historica
-- importada de planilha (não timestamp de deteccao no sync).
UPDATE public.ordens_notas_acompanhamento o
SET data_entrada = o.ordem_detectada_em
WHERE o.data_entrada IS NULL
  AND ABS(EXTRACT(EPOCH FROM (o.created_at - o.ordem_detectada_em))) >= 86400;

COMMENT ON COLUMN public.ordens_notas_acompanhamento.data_entrada IS
  'Data real de entrada/criação da ordem no sistema de origem (preferencialmente PMPL DATA_ENTRADA).';
