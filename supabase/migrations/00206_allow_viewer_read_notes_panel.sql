-- 00206_allow_viewer_read_notes_panel.sql
--
-- O papel viewer foi criado para transmissao/TV do cockpit, com acesso
-- estritamente somente leitura. O painel de notas roda sobre
-- vw_notas_sem_ordem + notas_operacao_estado, ambos sob SECURITY INVOKER/RLS.
-- Como as policies antigas liberavam leitura global apenas para gestor,
-- o viewer passava a enxergar zero notas mesmo com dados existentes.
--
-- Esta migration amplia somente as policies de SELECT necessarias para o
-- viewer ler o painel de notas globalmente. Nenhuma policy de escrita muda.

DROP POLICY IF EXISTS "Admin ve suas notas, gestor ve tudo"
  ON public.notas_manutencao;

CREATE POLICY "Admin ve suas notas, gestor ve tudo"
  ON public.notas_manutencao
  FOR SELECT
  TO authenticated
  USING (
    administrador_id = public.get_my_admin_id()
    OR public.get_my_role() IN ('gestor'::public.user_role, 'viewer'::public.user_role)
  );

DROP POLICY IF EXISTS "Admin ve estado operacional proprio e gestor ve tudo"
  ON public.notas_operacao_estado;

CREATE POLICY "Admin ve estado operacional proprio e gestor ve tudo"
  ON public.notas_operacao_estado
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() IN ('gestor'::public.user_role, 'viewer'::public.user_role)
    OR EXISTS (
      SELECT 1
      FROM public.notas_manutencao n
      WHERE n.id = public.notas_operacao_estado.nota_id
        AND n.administrador_id = public.get_my_admin_id()
    )
  );
