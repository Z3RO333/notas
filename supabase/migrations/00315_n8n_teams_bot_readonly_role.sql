-- 00315_n8n_teams_bot_readonly_role.sql
--
-- Role de leitura dedicada para o chatbot Teams (via n8n) consultar
-- responsavel atual de ordem/nota. Sem bypassrls, sem superuser — apenas
-- SELECT nas tabelas de base necessarias para vw_ordens_notas_painel
-- (que roda com security_invoker=on, logo herda o RLS de quem chama) e
-- para o fallback direto em notas_manutencao (nota ainda sem ordem).
--
-- Nota de implementação: vw_ordens_notas_painel chama duas funções puras
-- (normalizar_status_ordem, status_raw_eh_final) no corpo da view. A
-- migration 00314 revogou EXECUTE dessas funções de PUBLIC/anon/authenticated,
-- e como a view roda com security_invoker=on, o role que consulta a view
-- precisa de EXECUTE explícito nelas — sem isso a query da Task 1 (Step 4a)
-- falharia com "permission denied for function". Os dois GRANT EXECUTE
-- abaixo foram adicionados por esse motivo (não estavam no plano original).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_teams_bot') THEN
    CREATE ROLE n8n_teams_bot LOGIN PASSWORD 'CHANGE_ME_ROTATE_BEFORE_MERGE';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO n8n_teams_bot;

GRANT EXECUTE ON FUNCTION public.normalizar_status_ordem(text) TO n8n_teams_bot;
GRANT EXECUTE ON FUNCTION public.status_raw_eh_final(text) TO n8n_teams_bot;

GRANT SELECT ON public.vw_ordens_notas_painel TO n8n_teams_bot;
GRANT SELECT ON public.ordens_notas_acompanhamento TO n8n_teams_bot;
GRANT SELECT ON public.notas_manutencao TO n8n_teams_bot;
GRANT SELECT ON public.administradores TO n8n_teams_bot;
GRANT SELECT ON public.dim_centro_unidade TO n8n_teams_bot;
GRANT SELECT ON public.nota_acompanhamentos TO n8n_teams_bot;

DROP POLICY IF EXISTS "n8n_teams_bot le ordens_notas_acompanhamento" ON public.ordens_notas_acompanhamento;
CREATE POLICY "n8n_teams_bot le ordens_notas_acompanhamento"
  ON public.ordens_notas_acompanhamento
  FOR SELECT
  TO n8n_teams_bot
  USING (true);

DROP POLICY IF EXISTS "n8n_teams_bot le notas_manutencao" ON public.notas_manutencao;
CREATE POLICY "n8n_teams_bot le notas_manutencao"
  ON public.notas_manutencao
  FOR SELECT
  TO n8n_teams_bot
  USING (true);

DROP POLICY IF EXISTS "n8n_teams_bot le administradores" ON public.administradores;
CREATE POLICY "n8n_teams_bot le administradores"
  ON public.administradores
  FOR SELECT
  TO n8n_teams_bot
  USING (true);

DROP POLICY IF EXISTS "n8n_teams_bot le dim_centro_unidade" ON public.dim_centro_unidade;
CREATE POLICY "n8n_teams_bot le dim_centro_unidade"
  ON public.dim_centro_unidade
  FOR SELECT
  TO n8n_teams_bot
  USING (true);

DROP POLICY IF EXISTS "n8n_teams_bot le nota_acompanhamentos" ON public.nota_acompanhamentos;
CREATE POLICY "n8n_teams_bot le nota_acompanhamentos"
  ON public.nota_acompanhamentos
  FOR SELECT
  TO n8n_teams_bot
  USING (true);
