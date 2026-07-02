-- 00299_perf_quick_wins_indices_autovacuum.sql
--
-- Fase 1 (48h) do diagnóstico de performance de 2026-07-01:
--
-- 1. Segurança: backfill_data_entrada_from_financeiro foi recriada na 00163
--    sem SET search_path (o CREATE OR REPLACE descartou o hardening da 00080).
--    Auditoria em produção confirmou que é a única SECURITY DEFINER do schema
--    public sem search_path fixo (fora funções internas do PostGIS).
--
-- 2. Índice de expressão para o anti-join de ordens standalone: distribuir_notas,
--    vw_notas_sem_ordem, vw_carga_real_administradores e reconciliar_notas_em_geracao
--    comparam COALESCE(NULLIF(LTRIM(BTRIM(numero_nota),'0'),''),'0') em
--    ordens_notas_acompanhamento WHERE nota_id IS NULL — sem índice, cada nota
--    candidata paga um seq scan da tabela (679k seq scans medidos).
--    O lado notas_manutencao já tem o índice equivalente desde a 00144.
--    Obs: o índice de período COALESCE(data_entrada, ordem_detectada_em) já
--    existe (idx_ordens_notas_acompanhamento_data_referencia_dashboard).
--
-- 3. Bloat: ordens_notas_acompanhamento está com 76MB para 48k linhas e
--    notas_manutencao com 49MB para 22k (upserts massivos por sync), sync_log
--    com 23MB para 12k (update running→success por run + polling no topo do
--    índice). Autovacuum agressivo por tabela + fillfactor para habilitar HOT
--    updates. fillfactor só vale para páginas novas — compactação one-shot
--    (pg_repack/VACUUM FULL) fica para janela de manutenção, fora de migration.

-- ============================================================
-- 1. Hardening: search_path na SECURITY DEFINER que perdeu o atributo
-- ============================================================
ALTER FUNCTION public.backfill_data_entrada_from_financeiro(text[])
  SET search_path = public;

-- ============================================================
-- 2. Índice de expressão: numero_nota normalizado em ordens standalone
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ordens_acomp_numero_nota_norm_standalone
  ON public.ordens_notas_acompanhamento
  ((COALESCE(NULLIF(LTRIM(BTRIM(numero_nota), '0'), ''), '0')))
  WHERE nota_id IS NULL;

-- ============================================================
-- 3. Autovacuum agressivo + fillfactor nas tabelas com bloat
-- ============================================================
ALTER TABLE public.ordens_notas_acompanhamento SET (
  fillfactor = 80,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.notas_manutencao SET (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.sync_log SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 0
);
