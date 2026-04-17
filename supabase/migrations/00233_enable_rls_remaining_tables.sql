-- Habilita RLS nas 3 tabelas que estavam sem proteção.
--
-- centros_pool: dados de referência lidos pelo workspace de ordens via createClient()
-- dim_denominacao_norm: dados de referência, não exposta no frontend atual
-- sap_user_admin_map: mapeia usuários SAP → admins — acesso restrito a gestores

-- centros_pool
ALTER TABLE public.centros_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticado pode ler centros_pool"
  ON public.centros_pool
  FOR SELECT
  TO authenticated
  USING (true);

-- dim_denominacao_norm
ALTER TABLE public.dim_denominacao_norm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticado pode ler dim_denominacao_norm"
  ON public.dim_denominacao_norm
  FOR SELECT
  TO authenticated
  USING (true);

-- sap_user_admin_map
ALTER TABLE public.sap_user_admin_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gestor pode ler sap_user_admin_map"
  ON public.sap_user_admin_map
  FOR SELECT
  TO authenticated
  USING (get_my_role() = 'gestor'::public.user_role);
