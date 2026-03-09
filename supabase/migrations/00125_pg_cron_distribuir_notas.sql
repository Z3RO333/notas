-- Habilita pg_cron e agenda distribuir_notas() a cada 5 minutos
-- Garante que notas 'nova' sem admin sejam distribuídas mesmo se o job Databricks não chamar a função

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'distribuir-notas-cron',
  '*/5 * * * *',
  $$ SELECT distribuir_notas(NULL) $$
);
