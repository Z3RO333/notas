-- 00291_excluir_notas_historicas_pre2025.sql
--
-- O job Databricks fez uma importação histórica em 2026-06-15, trazendo 874 notas
-- com data_nota anterior a 2025 (algumas de 2011/2012). Essas notas não têm
-- contexto operacional atual e não devem aparecer no painel de notas.
-- Mecanismo idêntico ao usado para notas de frotas: exclui_cockpit=true.

-- ============================================================
-- 1. Marcar notas históricas como excluídas do cockpit
-- ============================================================
UPDATE public.notas_manutencao
SET exclui_cockpit   = true,
    administrador_id = NULL,
    updated_at       = now()
WHERE data_nota < '2025-01-01'
  AND exclui_cockpit = false;

-- ============================================================
-- 2. Remover do cockpit (notas_convergencia_cockpit)
-- ============================================================
DELETE FROM public.notas_convergencia_cockpit
WHERE nota_id IN (
  SELECT id FROM public.notas_manutencao
  WHERE data_nota < '2025-01-01'
);
