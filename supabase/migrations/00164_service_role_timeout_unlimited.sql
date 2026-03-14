-- 00164_service_role_timeout_unlimited.sql
--
-- service_role herda o global statement_timeout = 2min do Supabase.
-- O job de sync (Databricks) usa service_role e pode ter RPCs que levam
-- mais de 2 minutos (ex: enriquecer_ordens_por_referencia_manutencao,
-- atualizar_status_ordens_pmpl_lote com muitas ordens).
-- Fix: define timeout ilimitado para service_role (comportamento idêntico ao postgres).
--
ALTER ROLE service_role SET statement_timeout = '0';
