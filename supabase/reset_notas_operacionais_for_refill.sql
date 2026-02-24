-- reset_notas_operacionais_for_refill.sql
--
-- Uso: script manual para limpar dados operacionais de notas/ordens e permitir refill.
-- Nao faz parte das migrations automaticas (evita wipe acidental em ambientes novos).
--
-- Preserva tabelas de configuracao:
--   - administradores
--   - regras_distribuicao
--   - responsaveis_tipo_ordem
--   - dim_centro_unidade
--
-- Passos sugeridos:
-- 1) Execute a secao "pre-check" e valide os volumes.
-- 2) Execute a secao "reset".
-- 3) Rode os jobs em sequência:
--    a) sync_job_fast com bootstrap_mode=force
--    b) sync_job_medium
--    c) sync_job_heavy (1a execução com cockpit.sync.convergence_full_rebuild=true)
--    (mantendo sync_start_date configurado, ex: 2026-01-01).
-- 4) Requer migrations 00071 e 00074 aplicadas (convergência + estado_operacional).

-- ============================================================
-- PRE-CHECK (somente leitura)
-- ============================================================
SELECT 'notas_manutencao' AS tabela, COUNT(*) AS total FROM public.notas_manutencao
UNION ALL
SELECT 'notas_historico', COUNT(*) FROM public.notas_historico
UNION ALL
SELECT 'distribuicao_log', COUNT(*) FROM public.distribuicao_log
UNION ALL
SELECT 'nota_acompanhamentos', COUNT(*) FROM public.nota_acompanhamentos
UNION ALL
SELECT 'ordens_notas_acompanhamento', COUNT(*) FROM public.ordens_notas_acompanhamento
UNION ALL
SELECT 'ordens_notas_historico', COUNT(*) FROM public.ordens_notas_historico
UNION ALL
SELECT 'ordens_tipo_documento_referencia', COUNT(*) FROM public.ordens_tipo_documento_referencia
UNION ALL
SELECT 'ordens_manutencao_referencia', COUNT(*) FROM public.ordens_manutencao_referencia
UNION ALL
SELECT 'notas_convergencia_cockpit', COUNT(*) FROM public.notas_convergencia_cockpit
UNION ALL
SELECT 'sync_job_runtime_state', COUNT(*) FROM public.sync_job_runtime_state
UNION ALL
SELECT 'sync_log', COUNT(*) FROM public.sync_log
ORDER BY tabela;

-- ============================================================
-- RESET OPERACIONAL (destrutivo)
-- ============================================================
BEGIN;

TRUNCATE TABLE
  public.distribuicao_log,
  public.notas_historico,
  public.nota_acompanhamentos,
  public.ordens_notas_historico,
  public.ordens_notas_acompanhamento,
  public.notas_manutencao,
  public.ordens_tipo_documento_referencia,
  public.ordens_manutencao_referencia,
  public.notas_convergencia_cockpit,
  public.sync_job_runtime_state,
  public.sync_log;

COMMIT;

-- ============================================================
-- POS-CHECK
-- ============================================================
SELECT 'notas_manutencao' AS tabela, COUNT(*) AS total FROM public.notas_manutencao
UNION ALL
SELECT 'notas_historico', COUNT(*) FROM public.notas_historico
UNION ALL
SELECT 'distribuicao_log', COUNT(*) FROM public.distribuicao_log
UNION ALL
SELECT 'nota_acompanhamentos', COUNT(*) FROM public.nota_acompanhamentos
UNION ALL
SELECT 'ordens_notas_acompanhamento', COUNT(*) FROM public.ordens_notas_acompanhamento
UNION ALL
SELECT 'ordens_notas_historico', COUNT(*) FROM public.ordens_notas_historico
UNION ALL
SELECT 'ordens_tipo_documento_referencia', COUNT(*) FROM public.ordens_tipo_documento_referencia
UNION ALL
SELECT 'ordens_manutencao_referencia', COUNT(*) FROM public.ordens_manutencao_referencia
UNION ALL
SELECT 'notas_convergencia_cockpit', COUNT(*) FROM public.notas_convergencia_cockpit
UNION ALL
SELECT 'sync_job_runtime_state', COUNT(*) FROM public.sync_job_runtime_state
UNION ALL
SELECT 'sync_log', COUNT(*) FROM public.sync_log
ORDER BY tabela;
