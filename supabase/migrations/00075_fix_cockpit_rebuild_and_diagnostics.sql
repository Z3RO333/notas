-- 00075_fix_cockpit_rebuild_and_diagnostics.sql
--
-- Problema confirmado:
--   O cockpit está zerado porque build_cockpit_convergence_dataset() roda em modo
--   incremental com janela de 7 dias (CONVERGENCE_INCREMENTAL_DAYS = 7).
--   Notas históricas em notas_manutencao que não foram atualizadas recentemente
--   nunca entram em notas_convergencia_cockpit.
--
-- Este arquivo:
--   1. Documenta as queries de diagnóstico (executar antes/depois para baseline)
--   2. Cria função force_cockpit_convergence_recheck() — toca updated_at nas notas
--      abertas sem elegibilidade cockpit, forçando o heavy job a reprocessá-las
--      na próxima execução incremental.
--
-- Ação externa obrigatória (Databricks — fora do escopo SQL):
--   Para popular o cockpit com dados históricos completos, rodar o heavy job com:
--     cockpit.sync.convergence_full_rebuild = true
--     cockpit.sync.start_date = 2024-01-01
--   Após o rebuild único, reverter convergence_full_rebuild para false.

-- ============================================================
-- SEÇÃO DE DIAGNÓSTICO
-- (Execute manualmente para confirmar causa raiz e baseline)
-- ============================================================
/*
-- D1. Volume total e elegíveis em notas_convergencia_cockpit
SELECT
  COUNT(*)                         AS total_registros,
  SUM(eligible_cockpit::int)       AS elegiveis,
  SUM((NOT eligible_cockpit)::int) AS nao_elegiveis
FROM public.notas_convergencia_cockpit;

-- D2. Distribuição por estado_operacional
SELECT estado_operacional, COUNT(*) AS qtd
FROM public.notas_convergencia_cockpit
GROUP BY estado_operacional
ORDER BY qtd DESC;

-- D3. Range de datas e último sync na convergência
SELECT
  MIN(data_criacao_sap)  AS data_mais_antiga,
  MAX(data_criacao_sap)  AS data_mais_recente,
  MAX(updated_at)        AS ultimo_updated_at
FROM public.notas_convergencia_cockpit;

-- D4. Últimos sync_log (heavy/medium/fast)
SELECT
  id,
  started_at,
  finished_at,
  status,
  metadata->>'job_type'                          AS job_type,
  metadata->>'notas_convergencia_total_rows'     AS conv_total_rows,
  metadata->>'notas_convergencia_eligible_rows'  AS conv_eligible_rows
FROM public.sync_log
ORDER BY started_at DESC
LIMIT 20;

-- D5. Notas abertas em notas_manutencao que o heavy job NÃO reprocessaria
--     (updated_at > 7 dias → fora da janela incremental padrão)
SELECT COUNT(*) AS notas_fora_da_janela_incremental
FROM public.notas_manutencao
WHERE status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  AND updated_at < now() - INTERVAL '7 days';
-- Se > 0: esses são os registros "perdidos" pela janela de 7 dias.

-- D6. Notas abertas sem entrada elegível na convergência
SELECT COUNT(*) AS notas_abertas_sem_cockpit_eligivel
FROM public.notas_manutencao nm
WHERE nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
  AND NOT EXISTS (
    SELECT 1 FROM public.notas_convergencia_cockpit cc
    WHERE cc.nota_id = nm.id AND cc.eligible_cockpit = true
  );
*/

-- ============================================================
-- 1) Função: force_cockpit_convergence_recheck()
--    Toca updated_at de notas abertas sem elegibilidade cockpit.
--    Isso força o heavy job a reprocessá-las na próxima execução
--    incremental (janela 7 dias conta a partir de now()).
--
--    QUANDO USAR:
--    - Após corrigir DEFAULT_SYNC_START_DATE nos jobs Python
--    - Como alternativa ao full rebuild Databricks (mais lento)
--    - Chamar UMA VEZ; o heavy job cuida do resto no próximo ciclo
--
--    PRECAUÇÃO:
--    - Pode tocar muitas linhas se histórico for grande.
--    - O heavy job seguinte processará TODAS essas notas de uma vez.
--    - Prefira cockpit.sync.convergence_full_rebuild=true no Databricks
--      para históricos muito grandes (> 10.000 notas).
-- ============================================================
CREATE OR REPLACE FUNCTION public.force_cockpit_convergence_recheck()
RETURNS TABLE(total_touched INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.notas_manutencao nm
  SET updated_at = now()
  WHERE nm.status IN ('nova', 'em_andamento', 'encaminhada_fornecedor')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notas_convergencia_cockpit cc
      WHERE cc.nota_id = nm.id
        AND cc.eligible_cockpit = true
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE 'force_cockpit_convergence_recheck: % notas marcadas para reprocessamento.', v_count;

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION public.force_cockpit_convergence_recheck() IS
'Toca updated_at de notas abertas sem elegibilidade no cockpit, '
'forçando o heavy job a reprocessá-las na próxima execução incremental (janela 7 dias). '
'Chamar UMA VEZ após corrigir DEFAULT_SYNC_START_DATE nos jobs Python. '
'Para históricos grandes, prefira cockpit.sync.convergence_full_rebuild=true no Databricks.';

-- ============================================================
-- 2) Índice adicional para acelerar a query da função acima
--    (somente se ainda não existir)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_notas_manutencao_status_updated
  ON public.notas_manutencao (status, updated_at);

-- ============================================================
-- PRÓXIMOS PASSOS MANUAIS (fora desta migration):
--
-- A) Nos jobs Python (já feito nas migrations de código):
--    sync_shared.py:37         → DEFAULT_SYNC_START_DATE = "2024-01-01"
--    sync_notas_to_supabase.py → DEFAULT_SYNC_START_DATE = "2024-01-01"
--
-- B) No Databricks (ação obrigatória para full rebuild):
--    spark conf: cockpit.sync.convergence_full_rebuild = true
--    spark conf: cockpit.sync.start_date = 2024-01-01
--    → Rodar o heavy job UMA VEZ com essas configurações
--    → Reverter convergence_full_rebuild = false após concluir
--
-- C) Alternativa ao B (via Supabase):
--    SELECT * FROM public.force_cockpit_convergence_recheck();
--    → Aguardar próxima execução do heavy job
--
-- D) Validar resultado:
--    SELECT COUNT(*) FROM notas_convergencia_cockpit WHERE eligible_cockpit = true;
--    → Esperado: > 0
-- ============================================================
