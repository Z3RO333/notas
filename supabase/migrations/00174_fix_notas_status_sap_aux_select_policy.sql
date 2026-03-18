-- 00174_fix_notas_status_sap_aux_select_policy.sql
--
-- Problema:
--   vw_notas_sem_ordem roda com security_invoker = on e usa NOT EXISTS em
--   notas_status_sap_aux para excluir notas SAP CANCELADA/VIROU_ORDEM.
--   Como notas_status_sap_aux estava com RLS habilitado sem policy de SELECT
--   para authenticated, o painel não enxergava essas linhas e acabava
--   incluindo notas indevidas no cockpit.
--
-- Efeito observado:
--   Painel de notas inflado (~248) para usuários autenticados, enquanto o
--   recorte real esperado fica na faixa ~63-70.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notas_status_sap_aux'
      AND policyname = 'Autenticado le status aux SAP notas'
  ) THEN
    CREATE POLICY "Autenticado le status aux SAP notas"
      ON public.notas_status_sap_aux
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END;
$$;
