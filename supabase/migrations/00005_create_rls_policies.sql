-- 00005_create_rls_policies.sql
-- Row Level Security: admin ve so suas notas, gestor ve tudo

-- Habilita RLS em todas as tabelas
ALTER TABLE public.administradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_manutencao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribuicao_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ADMINISTRADORES
-- ============================================================
CREATE POLICY "Todos autenticados veem admins"
  ON public.administradores FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Gestor atualiza admins"
  ON public.administradores FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'gestor');

-- ============================================================
-- NOTAS_MANUTENCAO
-- ============================================================
-- Admin ve so suas notas; Gestor ve tudo
CREATE POLICY "Admin ve suas notas, gestor ve tudo"
  ON public.notas_manutencao FOR SELECT
  TO authenticated
  USING (
    administrador_id = get_my_admin_id()
    OR get_my_role() = 'gestor'
  );

-- Admin atualiza so suas notas; Gestor atualiza tudo
CREATE POLICY "Admin atualiza suas notas, gestor atualiza tudo"
  ON public.notas_manutencao FOR UPDATE
  TO authenticated
  USING (
    administrador_id = get_my_admin_id()
    OR get_my_role() = 'gestor'
  );

-- Insert: apenas gestor (sync job usa service_role que bypassa RLS)
CREATE POLICY "Gestor insere notas"
  ON public.notas_manutencao FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'gestor');

-- ============================================================
-- NOTAS_HISTORICO
-- ============================================================
CREATE POLICY "Auditoria visivel por dono da nota ou gestor"
  ON public.notas_historico FOR SELECT
  TO authenticated
  USING (
    nota_id IN (
      SELECT id FROM public.notas_manutencao
      WHERE administrador_id = get_my_admin_id()
    )
    OR get_my_role() = 'gestor'
  );

-- Insert feito via funcoes SECURITY DEFINER, nao precisa de policy

-- ============================================================
-- SYNC_LOG
-- ============================================================
CREATE POLICY "Gestor ve sync logs"
  ON public.sync_log FOR SELECT
  TO authenticated
  USING (get_my_role() = 'gestor');

-- ============================================================
-- DISTRIBUICAO_LOG
-- ============================================================
CREATE POLICY "Gestor ve distribuicao logs"
  ON public.distribuicao_log FOR SELECT
  TO authenticated
  USING (get_my_role() = 'gestor');
