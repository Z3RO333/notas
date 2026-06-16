-- Databricks sync jobs already call distribuir_notas() once after a successful
-- sync. Remove the redundant five-minute database scheduler to avoid duplicate
-- CPU, lock, WAL, and log work. Manual RPC execution remains available.

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR v_job_id IN
    EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1'
    USING 'distribuir-notas-cron'
  LOOP
    EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
  END LOOP;
END;
$$;
