-- 00282_drop_old_calcular_kpis_pedidos_workspace_overload.sql
--
-- A migration 00276 tentou substituir a assinatura de
-- calcular_kpis_pedidos_workspace via CREATE OR REPLACE, mas Postgres não
-- permite alterar a lista de parâmetros dessa forma — resultado: as duas
-- versões (4 e 6 parâmetros) coexistiam no banco, causando erro de
-- "Could not choose the best candidate function" no PostgREST.
--
-- Remove a versão antiga (4 parâmetros), mantendo apenas a versão com
-- p_status e p_q (00276).

DROP FUNCTION IF EXISTS public.calcular_kpis_pedidos_workspace(uuid, uuid, text, text);
