-- 00126_auto_aplicar_ferias.sql
--
-- Automação de início/fim de férias por data.
-- Cria função auto_aplicar_ferias() e agenda via pg_cron diariamente às 06:00 (Manaus = UTC-4 = 10:00 UTC).
--
-- Lógica:
--   - Se data_inicio_ferias <= hoje E em_ferias = false → marcar em_ferias = true
--   - Se data_fim_ferias < hoje E em_ferias = true (com data_fim_ferias preenchida) → marcar em_ferias = false

CREATE OR REPLACE FUNCTION public.auto_aplicar_ferias()
RETURNS void AS $$
BEGIN
  -- Iniciar férias quando a data de início chegou
  UPDATE public.administradores
  SET
    em_ferias  = true,
    updated_at = now()
  WHERE ativo = true
    AND em_ferias = false
    AND data_inicio_ferias IS NOT NULL
    AND data_inicio_ferias <= CURRENT_DATE
    AND (data_fim_ferias IS NULL OR data_fim_ferias >= CURRENT_DATE);

  -- Encerrar férias quando a data de fim passou
  UPDATE public.administradores
  SET
    em_ferias  = false,
    updated_at = now()
  WHERE ativo = true
    AND em_ferias = true
    AND data_fim_ferias IS NOT NULL
    AND data_fim_ferias < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.auto_aplicar_ferias() IS
  'Ativa/desativa férias automaticamente com base em data_inicio_ferias e data_fim_ferias. '
  'Executada diariamente via pg_cron às 06:00 (horário de Manaus).';

-- Agendar para rodar todo dia às 10:00 UTC = 06:00 Manaus (UTC-4)
SELECT cron.schedule(
  'auto-ferias-admins',
  '0 10 * * *',
  $$ SELECT public.auto_aplicar_ferias() $$
);
